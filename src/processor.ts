import OpenAI from 'openai';
import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, extname, basename } from 'path';
import type { ProcessConfig, PromptFile, ProcessResult, ModelConfig } from './types.ts';
import { formatDuration } from './utils.ts';

export class LLMProcessor {
  private client: OpenAI;
  private config: ProcessConfig;

  constructor(config: ProcessConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/mrchrishahn/parallel-llm-processor',
        'X-Title': 'Parallel LLM Processor',
      },
    });
  }

  async findPromptFiles(directory: string): Promise<PromptFile[]> {
    try {
      const files = await readdir(directory);
      const promptFiles: PromptFile[] = [];

      for (const file of files) {
        const filePath = join(directory, file);
        const ext = extname(file);
        
        // Check if it's a file and not a directory
        try {
          const stats = await stat(filePath);
          if (!stats.isFile()) {
            continue; // Skip directories and other non-file entities
          }
        } catch (error) {
          console.warn(`Warning: Could not stat file ${file}:`, error);
          continue;
        }
        
        // Process .txt, .md, and files without extension as prompts
        if (ext === '.txt' || ext === '.md' || ext === '') {
          try {
            const content = await readFile(filePath, 'utf-8');
            const baseName = basename(file, ext);
            const outputPath = join(directory, `${baseName}_result.txt`);
            
            promptFiles.push({
              path: filePath,
              name: file,
              content: content.trim(),
              outputPath,
            });
          } catch (error) {
            console.warn(`Warning: Could not read file ${file}:`, error);
          }
        }
      }

      return promptFiles;
    } catch (error) {
      throw new Error(`Failed to read directory ${directory}: ${error}`);
    }
  }

  private async processPrompt(promptFile: PromptFile): Promise<ProcessResult> {
    const startTime = Date.now();
    
    try {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
          role: 'user',
          content: promptFile.content,
        },
      ];

      let modelName = this.config.modelConfig.model;
      const requestConfig: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
        model: modelName,
        messages,
        temperature: this.config.modelConfig.temperature,
        max_tokens: this.config.modelConfig.maxTokens,
        top_p: this.config.modelConfig.topP,
        frequency_penalty: this.config.modelConfig.frequencyPenalty,
        presence_penalty: this.config.modelConfig.presencePenalty,
      };

      if (this.config.webSearch) {
        if (this.config.reasoningLevel) {
          // Non-plugin web search for models that support it
          (requestConfig as any).web_search_options = { search_context_size: this.config.reasoningLevel };
        } else {
          // Standard web search via plugin
          modelName = `${modelName}:online`;
        }
      }
      
      requestConfig.model = modelName;

      // Add reasoning for o1 models or when thinking is enabled
      if ((this.config.modelConfig as any).reasoning) {
        (requestConfig as any).reasoning = {};
      }

      const completion = await this.client.chat.completions.create(requestConfig);
      
      const result = completion.choices[0]?.message?.content || 'No response generated';
      
      // Write result to output file
      await writeFile(promptFile.outputPath, result, 'utf-8');
      
      const duration = Date.now() - startTime;
      
      const usage = completion.usage;
      let cost = 0;
      if (usage) {
        const { prompt_tokens, completion_tokens } = usage;
        const promptPrice = parseFloat(this.config.model.pricing.prompt);
        const completionPrice = parseFloat(this.config.model.pricing.completion);
        cost = (prompt_tokens * promptPrice) + (completion_tokens * completionPrice);
      }
      
      return {
        file: promptFile.name,
        success: true,
        result,
        duration,
        usage: usage || undefined,
        cost: cost || undefined,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      return {
        file: promptFile.name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration,
      };
    }
  }

  async processAll(): Promise<ProcessResult[]> {
    const promptFiles = await this.findPromptFiles(this.config.directory);
    
    if (promptFiles.length === 0) {
      throw new Error(`No prompt files found in directory: ${this.config.directory}`);
    }

    console.log(`Found ${promptFiles.length} prompt files to process`);
    
    // Process prompts in parallel with concurrency limit
    const concurrency = this.config.concurrent || 3;
    const results: ProcessResult[] = [];
    
    for (let i = 0; i < promptFiles.length; i += concurrency) {
      const batch = promptFiles.slice(i, i + concurrency);
      const batchPromises = batch.map(file => this.processPrompt(file));
      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map(result => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          // Find the prompt file that corresponds to the rejected promise
          const failedFile = promptFiles[i + batchPromises.indexOf(result.reason)];
          return {
            file: failedFile.name,
            success: false,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            duration: 0, // Duration is unknown for failed promises before processing starts
          };
        }
      }));
      
      console.log(`Processed batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(promptFiles.length / concurrency)}`);
    }
    
    return results;
  }

  async processContextualPrompt(
    mainPromptFile: PromptFile,
    contextFiles: PromptFile[],
    config: ProcessConfig
  ): Promise<ProcessResult> {
    const startTime = Date.now();
    try {
      let mainPromptContent = mainPromptFile.content;
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

      // 1. Find and inject explicitly referenced files
      const explicitlyReferencedFiles = new Set<string>();
      const injectionRegex = /{{\s*([^}]+)\s*}}/g;

      mainPromptContent = mainPromptContent.replace(
        injectionRegex,
        (match, fileName) => {
          const referencedFile = contextFiles.find(
            (file) => file.name === fileName.trim()
          );
          if (referencedFile) {
            explicitlyReferencedFiles.add(referencedFile.path);
            return referencedFile.content;
          }
          // If file not found, leave placeholder to indicate missing context
          return `[Warning: Context file "${fileName}" not found]`;
        }
      );

      // 2. Prepend all other files as context
      const implicitContextFiles = contextFiles.filter(
        (file) => !explicitlyReferencedFiles.has(file.path)
      );

      if (implicitContextFiles.length > 0) {
        const contextBlock = implicitContextFiles
          .map(
            (file) =>
              `--- CONTEXT FROM ${file.name} ---\n${file.content}\n`
          )
          .join("\n");

        messages.push({
          role: "system",
          content: `The following information is provided as context from other files in the directory. Use it to inform your response.\n\n${contextBlock}`,
        });
      }
      
      // 3. Add the assembled main prompt
      messages.push({
        role: "user",
        content: mainPromptContent,
      });
      
      // 4. Build and execute the request
      let modelName = config.modelConfig.model;
      const requestConfig: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
        model: modelName,
        messages,
        temperature: config.modelConfig.temperature,
        max_tokens: config.modelConfig.maxTokens,
        top_p: config.modelConfig.topP,
      };

      if (config.webSearch) {
        if (config.reasoningLevel) {
          (requestConfig as any).web_search_options = { search_context_size: config.reasoningLevel };
        } else {
          modelName = `${modelName}:online`;
        }
      }
      requestConfig.model = modelName;
      
      // Add reasoning for o1 models or when thinking is enabled
      if ((config.modelConfig as any).reasoning) {
        (requestConfig as any).reasoning = {};
      }

      const completion = await this.client.chat.completions.create(requestConfig);
      const result = completion.choices[0]?.message?.content || 'No response generated';
      await writeFile(mainPromptFile.outputPath, result, 'utf-8');

      const usage = completion.usage;
      let cost = 0;
      if (usage) {
        const { prompt_tokens, completion_tokens } = usage;
        const model = this.config.model;
        const promptPrice = parseFloat(model.pricing.prompt);
        const completionPrice = parseFloat(model.pricing.completion);
        cost = (prompt_tokens * promptPrice) + (completion_tokens * completionPrice);
      }

      return {
        file: mainPromptFile.name,
        success: true,
        result,
        duration: Date.now() - startTime,
        usage: usage || undefined,
        cost: cost || undefined,
      };
    } catch (error) {
      return {
        file: mainPromptFile.name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }
} 