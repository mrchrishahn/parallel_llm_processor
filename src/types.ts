export interface ModelConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  thinking?: boolean;
  tools?: boolean;
}

export interface ProcessConfig {
  directory: string;
  modelConfig: ModelConfig;
  model: OpenRouterModel;
  apiKey: string;
  concurrent?: number;
  webSearch?: boolean;
  reasoningLevel?: 'low' | 'medium' | 'high';
}

export interface PromptFile {
  path: string;
  name: string;
  content: string;
  outputPath: string;
}

export interface ProcessResult {
  file: string;
  success: boolean;
  result?: string;
  error?: string;
  duration: number;
  cost?: number;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// New interfaces for CSV processing
export interface CSVProcessConfig extends ProcessConfig {
  csvPath: string;
  templatePath: string;
  outputDirectory: string;
  idColumn?: string; // Column to use as identifier for output files
}

export interface CSVRow {
  [key: string]: string | number | boolean;
}

export interface CSVProcessResult extends ProcessResult {
  rowIndex: number;
  rowData: CSVRow;
  outputFilePath: string;
}

// New interfaces for file combination
export interface FileCombineConfig {
  sourceDirectory: string;
  outputPath: string;
  includeMetadata?: boolean;
  jsonKeysToExtract?: string[]; // For JSON files, specify which keys to extract
}

export interface CombinedFileData {
  filename: string;
  filepath: string;
  content: any;
  fileType: 'json' | 'text' | 'other';
  parseError?: string;
  metadata?: {
    size: number;
    created: Date;
    modified: Date;
  };
}

const SupportedParametersDictionary = {
  tools: 'Function calling capabilities',
  tool_choice: 'Tool selection control',
  max_tokens: 'Response length limiting',
  temperature: 'Randomness control',
  top_p: 'Nucleus sampling',
  reasoning: 'Internal reasoning mode',
  include_reasoning: 'Include reasoning in response',
  structured_outputs: 'JSON schema enforcement',
  response_format: 'Output format specification',
  stop: 'Custom stop sequences',
  frequency_penalty: 'Repetition reduction',
  presence_penalty: 'Topic diversity',
  seed: 'Deterministic outputs',
} 

type SupportedParameters = keyof typeof SupportedParametersDictionary;

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing: {
    prompt: string;
    completion: string;
  };
  context_length: number;
  architecture: {
    modality: string;
    tokenizer: string;
    instruct_type?: string;
  };
  top_provider: {
    context_length: number;
    max_completion_tokens?: number;
  };
  per_request_limits?: {
    prompt_tokens: string;
    completion_tokens: string;
  };
  supported_parameters?: SupportedParameters[];
}

export interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
} 