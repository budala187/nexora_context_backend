export interface ToolConfig {
    name: string;
    priority: number;
    depth: string;
    focus: string[];
    reason: string;
    clerkUserId?: string;
    [key: string]: any; 
  }
  
  export interface ToolResponse {
    success: boolean;
    data: any;
    error?: string;
  }
  
  export interface ToolInfo {
    name: string;
    description: string;
    good_for: string[];
  }
  
  export abstract class BaseTool {
    abstract name: string;
    abstract description: string;
    abstract good_for: string[];
    
    abstract execute(query: string, config: ToolConfig): Promise<ToolResponse>;
    
    getInfo(): ToolInfo {
      return {
        name: this.name,
        description: this.description,
        good_for: this.good_for
      };
    }
  }