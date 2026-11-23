
export type AIMessage = {
  role: "system" | "user";
  content: string;
};

export type AIRequest = {
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type AIResponse = {
  text: string;
  provider: string;
  model: string;
};

export interface AIProvider {
  generate(request: AIRequest): Promise<AIResponse>;
}
