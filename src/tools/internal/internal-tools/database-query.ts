import { BaseTool, ToolConfig, ToolResponse } from '../base-tool.js';
import { logger } from '../../../lib/logger.js';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import weaviate from "weaviate-ts-client";

// Configuration variables you asked for
const WEAVIATE_CLASS_NAME = process.env.WEAVIATE_CLASS_NAME!;
const OPENAI_MODEL_REPHRASE = process.env.OPENAI_MODEL_REPHRASE!;
const EXTRACT_ENTITIES_MODEL = process.env.EXTRACT_ENTITIES_MODEL!;

interface SearchResult {
  source: 'keyword' | 'knowledge_graph' | 'vector';
  content: string;
  metadata?: any;
  score?: number;
}

interface EntityWithDocument {
  entity: string;
  documentId: string;
}

export class DatabaseQueryTool extends BaseTool {
  name = 'database_query';
  description = 'Query all user-uploaded data from structured database, knowledge graph, and vector database';
  good_for = [
    'user uploaded data',
    'private information',
    'documents analysis',
    'finding specific content',
    'contextual search',
    'data not available elsewhere'
  ];
  
  private openai: OpenAI;
  private supabase: any;
  private weaviateClient: any;
  
  constructor() {
    super();
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    this.supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );
    
    this.weaviateClient = (weaviate as any).client({
      scheme: 'https',
      host: process.env.WEAVIATE_HOST!,
      apiKey: new (weaviate as any).ApiKey(process.env.WEAVIATE_API_KEY!),
      headers: {
        'X-OpenAI-Api-Key': process.env.OPENAI_APIKEY!
      }
    });
  }
  
  async execute(query: string, config: ToolConfig): Promise<ToolResponse> {
    try {
      logger.info(`💾 Database query: ${query}`);
      
      const clerkUserId = config.clerkUserId;
      
      if (!clerkUserId) {
        throw new Error('clerk_user_id is required for database queries');
      }
      
      // Step 1: Rephrase query for better coverage
      const rephrased = await this.rephraseQuery(query);
      const allQueries = [query, ...rephrased];
      logger.info(`📝 Generated ${allQueries.length} query variations`);
      
      // Step 2: Execute all three search types in parallel
      const [keywordResults, knowledgeGraphResults, vectorResults] = await Promise.all([
        this.keywordSearch(query, clerkUserId),
        this.knowledgeGraphSearch(query, clerkUserId),
        this.vectorSearch(allQueries, clerkUserId)
      ]);
      
      // Step 3: Get additional vector searches for knowledge graph entities with their document IDs
      const entityVectorResults = await this.searchEntitiesInVector(
        knowledgeGraphResults.entitiesWithDocuments || [],
        clerkUserId
      );
      
      // Step 4: Combine all results
      const allResults: SearchResult[] = [
        ...keywordResults,
        ...knowledgeGraphResults.results,
        ...vectorResults,
        ...entityVectorResults
      ];
      
      logger.info(`📊 Total results: ${allResults.length} from all sources`);
      
      return {
        success: true,
        data: {
          results: allResults,
          queryVariations: allQueries,
          totalResults: allResults.length,
          sources: {
            keyword: keywordResults.length,
            knowledgeGraph: knowledgeGraphResults.results.length,
            vector: vectorResults.length + entityVectorResults.length
          }
        }
      };
      
    } catch (error) {
      logger.error('Database query failed:', error);
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  private async rephraseQuery(query: string): Promise<string[]> {
    const prompt = `Rephrase this query in 2 different ways to capture different aspects and synonyms.
Original query: "${query}"

Return ONLY a JSON array with 2 rephrased versions:
["rephrased version 1", "rephrased version 2"]`;
    
    try {
      const response = await this.openai.chat.completions.create({
        model: OPENAI_MODEL_REPHRASE,
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 400
      });
      
      const content = response.choices[0]?.message?.content || '[]';
      return JSON.parse(content);
    } catch (error) {
      logger.warn('Failed to rephrase query, using original only');
      return [];
    }
  }
  
  private async keywordSearch(query: string, clerkUserId: string): Promise<SearchResult[]> {
    try {
      logger.info('About to query KEYWORD SEARCH table', { clerkUserId });
      logger.info(`🔍 Keyword search in Supabase: ${query}`);
      
      const { data, error } = await this.supabase
        .rpc('keyword_search_with_context', {
          search_query: query,
          user_id: clerkUserId,
          context_words: 50
        });
      
      if (error) {
        logger.error('Supabase error:', error);
        return [];
      }
      
      return (data || []).map((item: any) => ({
        source: 'keyword' as const,
        content: item.context_text || '',
        metadata: {
          data_id: item.data_id,
          match_position: item.match_position,
          total_matches: item.total_matches
        }
      }));
      
    } catch (error) {
      logger.error('Keyword search failed:', error);
      return [];
    }
  }
  
  private async extractEntitiesFromQuery(query: string): Promise<string[]> {
    try {
      const response = await this.openai.chat.completions.create({
        model: EXTRACT_ENTITIES_MODEL,
        messages: [
          {
            role: 'system',
            content: 'Extract all entities (people, places, concepts, organizations, etc.) from the user query. Return only a JSON object with an "entities" array containing entity names as strings. Example: {"entities": ["artificial intelligence", "machine learning", "neural networks"]}'
          },
          {
            role: 'user',
            content: query
          }
        ],
        response_format: { type: "json_object" },
      });
  
      const content = response.choices[0]?.message?.content || '{"entities": []}';
      const parsed = JSON.parse(content);
      return parsed.entities || [];
    } catch (error) {
      logger.error('Entity extraction failed:', error);
      return [];
    }
  }
  
  private async knowledgeGraphSearch(query: string, clerkUserId: string): Promise<{
    results: SearchResult[];
    entities: string[];
    entitiesWithDocuments: EntityWithDocument[];
  }> {
    try {
      logger.info('About to query KNOWLEDGE GRAPH table', { clerkUserId });
      logger.info(`🕸️ Knowledge graph search: ${query}`);
      
      // Step 1: Extract entities from the user query
      const extractedEntities = await this.extractEntitiesFromQuery(query);
      logger.info(`🧠 Extracted entities: ${extractedEntities.join(', ')}`);
      
      if (extractedEntities.length === 0) {
        logger.info('No entities extracted, skipping knowledge graph search');
        return { results: [], entities: [], entitiesWithDocuments: [] };
      }
  
      const results: SearchResult[] = [];
      const foundEntities: string[] = [];
      const entitiesWithDocuments: EntityWithDocument[] = [];
  
      // Step 2: Find each entity in the knowledge base using function
      for (const entityName of extractedEntities) {
        try {
          // Call search_knowledge_entities function
          const { data: entityData, error: entityError } = await this.supabase
            .rpc('search_knowledge_entities', {
              search_entity_name: entityName,
              user_id: clerkUserId
            });
  
          if (entityError) {
            logger.error(`Entity search error for "${entityName}":`, entityError);
            continue;
          }
  
          // Step 3: Process found entities and get their relationships/properties
          for (const entity of entityData || []) {
            const entityNameFromData = entity.entity_name;
            const entityType = entity.entity_type;
            const entityDescription = entity.entity_description;
            const documentId = entity.data_id;
  
            foundEntities.push(entityNameFromData);
            entitiesWithDocuments.push({
              entity: entityNameFromData,
              documentId: documentId
            });
  
            // Add the entity itself to results
            results.push({
              source: 'knowledge_graph' as const,
              content: `Entity: ${entityNameFromData} (${entityType}): ${entityDescription || 'No description'}`,
              metadata: {
                entity_name: entityNameFromData,
                entity_type: entityType,
                data_id: documentId,
                type: 'entity'
              }
            });
  
            // Step 4: Get relationships for this entity from the same document using function
            const { data: relationshipData, error: relationshipError } = await this.supabase
              .rpc('search_knowledge_relationships', {
                search_entity_name: entityNameFromData,
                user_id: clerkUserId,
                document_id: documentId
              });
  
            if (!relationshipError && relationshipData) {
              for (const relationship of relationshipData) {
                results.push({
                  source: 'knowledge_graph' as const,
                  content: `Relationship: ${relationship.subject} → ${relationship.predicate} → ${relationship.object}`,
                  metadata: {
                    relationship_source: relationship.subject,
                    relationship_target: relationship.object,
                    relationship_type: relationship.predicate,
                    data_id: relationship.data_id,
                    type: 'relationship'
                  }
                });
              }
            }
  
            // Step 5: Get related entities from the same document using function
            const { data: relatedEntityData, error: relatedEntityError } = await this.supabase
              .rpc('get_related_entities', {
                search_entity_name: entityNameFromData,
                user_id: clerkUserId,
                document_id: documentId
              });
  
            if (!relatedEntityError && relatedEntityData) {
              for (const relatedEntity of relatedEntityData) {
                results.push({
                  source: 'knowledge_graph' as const,
                  content: `Related Entity: ${relatedEntity.entity_name} (${relatedEntity.entity_type})`,
                  metadata: {
                    entity_name: relatedEntity.entity_name,
                    entity_type: relatedEntity.entity_type,
                    relationship_type: relatedEntity.relationship_type,
                    data_id: relatedEntity.data_id,
                    type: 'related_entity'
                  }
                });
              }
            }
          }
        } catch (entityError) {
          logger.error(`Failed to process entity "${entityName}":`, entityError);
        }
      }
  
      logger.info(`📊 Knowledge graph found ${results.length} results for ${foundEntities.length} entities`);
      
      return {
        results,
        entities: foundEntities,
        entitiesWithDocuments
      };
      
    } catch (error) {
      logger.error('Knowledge graph search failed:', error);
      return { results: [], entities: [], entitiesWithDocuments: [] };
    }
  }
  
  private async vectorSearch(queries: string[], clerkUserId: string): Promise<SearchResult[]> {
    try {
      logger.info(`🎯 Vector search with ${queries.length} queries`);
      
      const allResults: SearchResult[] = [];
      
      for (const q of queries) {
        try {
          const result = await this.weaviateClient
            .graphql
            .get()
            .withClassName(WEAVIATE_CLASS_NAME)
            .withTenant(clerkUserId)
            .withNearText({ concepts: [q] })
            .withLimit(5)
            .withFields('content document_id _additional { certainty distance }')
            .do();
          
          if (result.data?.Get?.[WEAVIATE_CLASS_NAME]) {
            for (const doc of result.data.Get[WEAVIATE_CLASS_NAME]) {
              allResults.push({
                source: 'vector' as const,
                content: doc.content || '',
                score: doc._additional?.certainty || 0,
                metadata: { 
                  query: q,
                  document_id: doc.document_id,
                  distance: doc._additional?.distance
                }
              });
            }
          }
        } catch (queryError) {
          logger.error(`Vector search failed for query "${q}":`, queryError);
        }
      }
      
      return allResults;
      
    } catch (error) {
      logger.error('Vector search failed:', error);
      return [];
    }
  }
  
  private async searchEntitiesInVector(entitiesWithDocuments: EntityWithDocument[], clerkUserId: string): Promise<SearchResult[]> {
    if (entitiesWithDocuments.length === 0) return [];
    
    try {
      logger.info(`🔎 Searching ${entitiesWithDocuments.length} entities with document IDs in vector DB`);
      
      const results: SearchResult[] = [];
      
      for (const entityDoc of entitiesWithDocuments) {
        try {
          const result = await this.weaviateClient
            .graphql
            .get()
            .withClassName(WEAVIATE_CLASS_NAME)
            .withTenant(clerkUserId)
            .withNearText({ concepts: [entityDoc.entity] })
            .withWhere({
              path: ['document_id'],
              operator: 'Equal',
              valueText: entityDoc.documentId
            })
            .withLimit(3)
            .withFields('content document_id _additional { certainty distance }')
            .do();
          
          if (result.data?.Get?.[WEAVIATE_CLASS_NAME]) {
            for (const doc of result.data.Get[WEAVIATE_CLASS_NAME]) {
              results.push({
                source: 'vector' as const,
                content: doc.content || '',
                score: doc._additional?.certainty || 0,
                metadata: { 
                  entity: entityDoc.entity,
                  document_id: doc.document_id,
                  fromKnowledgeGraph: true,
                  distance: doc._additional?.distance
                }
              });
            }
          }
        } catch (entityError) {
          logger.error(`Entity vector search failed for "${entityDoc.entity}" in document "${entityDoc.documentId}":`, entityError);
        }
      }
      
      return results;
      
    } catch (error) {
      logger.error('Entity vector search failed:', error);
      return [];
    }
  }
}

export default DatabaseQueryTool;