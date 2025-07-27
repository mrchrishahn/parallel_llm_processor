import OpenAI from 'openai';
import { readdir, readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import type { ProcessConfig, PromptFile, ProcessResult, CSVProcessResult, CSVRow, CombinedFileData } from './types.ts';

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
          (_match, fileName) => {
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

  // CSV Processing Methods
  async processCsvWithTemplate(csvPath: string, templatePath: string, outputDirectory: string, idColumn?: string): Promise<CSVProcessResult[]> {
    const csv = await import('csv-parser');
    const { createReadStream } = await import('node:fs');
    
    // Read template
    const template = await readFile(templatePath, 'utf-8');
    
    // Ensure output directory exists
    await mkdir(outputDirectory, { recursive: true });
    
    // Parse CSV
    const rows: CSVRow[] = [];
    return new Promise((resolve, reject) => {
      createReadStream(csvPath)
        .pipe(csv.default())
        .on('data', (row: CSVRow) => {
          rows.push(row);
        })
        .on('end', async () => {
          try {
            const results = await this.processCSVRows(rows, template, outputDirectory, idColumn);
            resolve(results);
          } catch (error) {
            reject(error);
          }
        })
        .on('error', reject);
    });
  }

  private async processCSVRows(rows: CSVRow[], template: string, outputDirectory: string, idColumn?: string): Promise<CSVProcessResult[]> {
    const concurrency = this.config.concurrent || 3;
    const results: CSVProcessResult[] = [];
    
    for (let i = 0; i < rows.length; i += concurrency) {
      const batch = rows.slice(i, i + concurrency);
      const batchPromises = batch.map((row, batchIndex) => 
        this.processCSVRow(row, template, outputDirectory, i + batchIndex, idColumn)
      );
      const batchResults = await Promise.allSettled(batchPromises);
      
      results.push(...batchResults.map(result => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          const rowIndex = i + batchResults.indexOf(result.reason);
          return {
            file: `row_${rowIndex}`,
            success: false,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            duration: 0,
            rowIndex,
            rowData: rows[rowIndex],
            outputFilePath: '',
          };
        }
      }));
      
      console.log(`Processed CSV batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(rows.length / concurrency)}`);
    }
    
    return results;
  }

  private async processCSVRow(row: CSVRow, template: string, outputDirectory: string, rowIndex: number, idColumn?: string): Promise<CSVProcessResult> {
    const startTime = Date.now();
    
    try {
      // Replace template variables with row data
      let processedPrompt = template;
      Object.keys(row).forEach(key => {
        const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        processedPrompt = processedPrompt.replace(placeholder, String(row[key]));
      });

      // Generate output filename
      const identifier = idColumn && row[idColumn] ? String(row[idColumn]) : `row_${rowIndex}`;
      const outputFilePath = join(outputDirectory, `${identifier}_result.txt`);

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
          role: 'user',
          content: processedPrompt,
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
          (requestConfig as any).web_search_options = { search_context_size: this.config.reasoningLevel };
        } else {
          modelName = `${modelName}:online`;
        }
      }
      
      requestConfig.model = modelName;

      if ((this.config.modelConfig as any).reasoning) {
        (requestConfig as any).reasoning = {};
      }

      const completion = await this.client.chat.completions.create(requestConfig);
      const result = completion.choices[0]?.message?.content || 'No response generated';
      
      await writeFile(outputFilePath, result, 'utf-8');
      
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
        file: `${identifier}_result.txt`,
        success: true,
        result,
        duration,
        usage: usage || undefined,
        cost: cost || undefined,
        rowIndex,
        rowData: row,
        outputFilePath,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const identifier = idColumn && row[idColumn] ? String(row[idColumn]) : `row_${rowIndex}`;
      
      return {
        file: `${identifier}_result.txt`,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration,
        rowIndex,
        rowData: row,
        outputFilePath: '',
      };
    }
  }

  // File Combination Methods
  async combineFilesToCSV(sourceDirectory: string, outputPath: string, includeMetadata = false): Promise<void> {
    const csvWriter = await import('csv-writer');
    
    const files = await readdir(sourceDirectory);
    const combinedData: CombinedFileData[] = [];
    
    for (const file of files) {
      const filePath = join(sourceDirectory, file);
      const stats = await stat(filePath);
      
      if (!stats.isFile()) continue;
      
      try {
        const content = await readFile(filePath, 'utf-8');
        const ext = extname(file).toLowerCase();
        
        let parsedContent: any = content;
        let fileType: 'json' | 'text' | 'other' = 'text';
        let parseError: string | undefined;
        
        if (ext === '.json') {
          try {
            parsedContent = JSON.parse(content);
            fileType = 'json';
          } catch (error) {
            parseError = error instanceof Error ? error.message : 'Failed to parse JSON';
            fileType = 'other';
          }
        }
        
        const fileData: CombinedFileData = {
          filename: file,
          filepath: filePath,
          content: parsedContent,
          fileType,
          parseError,
        };
        
        if (includeMetadata) {
          fileData.metadata = {
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
          };
        }
        
        combinedData.push(fileData);
      } catch (error) {
        // Skip files that can't be read
        console.warn(`Warning: Could not read file ${file}:`, error);
      }
    }
    
    // Determine CSV structure based on data
    const headers = this.generateCSVHeaders(combinedData, includeMetadata);
    const csvRows = this.flattenDataForCSV(combinedData, headers);
    
    const writer = csvWriter.createObjectCsvWriter({
      path: outputPath,
      header: headers.map(h => ({ id: h, title: h })),
    });
    
    await writer.writeRecords(csvRows);
  }

  private generateCSVHeaders(data: CombinedFileData[], includeMetadata: boolean): string[] {
    const headers = new Set<string>(['filename', 'filepath', 'fileType']);
    
    if (includeMetadata) {
      headers.add('size');
      headers.add('created');
      headers.add('modified');
    }
    
    // For JSON files, extract all unique keys
    data.forEach(item => {
      if (item.fileType === 'json' && typeof item.content === 'object' && item.content !== null) {
        Object.keys(item.content).forEach(key => headers.add(`json_${key}`));
      } else if (item.fileType === 'text') {
        headers.add('text_content');
      }
      
      if (item.parseError) {
        headers.add('parseError');
      }
    });
    
    return Array.from(headers);
  }

  private flattenDataForCSV(data: CombinedFileData[], headers: string[]): any[] {
    return data.map(item => {
      const row: any = {
        filename: item.filename,
        filepath: item.filepath,
        fileType: item.fileType,
      };
      
      if (item.metadata) {
        row.size = item.metadata.size;
        row.created = item.metadata.created.toISOString();
        row.modified = item.metadata.modified.toISOString();
      }
      
      if (item.parseError) {
        row.parseError = item.parseError;
      }
      
      if (item.fileType === 'json' && typeof item.content === 'object' && item.content !== null) {
        Object.keys(item.content).forEach(key => {
          const value = item.content[key];
          row[`json_${key}`] = typeof value === 'object' ? JSON.stringify(value) : value;
        });
      } else if (item.fileType === 'text') {
        row.text_content = item.content;
      }
      
      // Ensure all headers are present
      headers.forEach(header => {
        if (!(header in row)) {
          row[header] = '';
        }
      });
      
      return row;
    });
  }
} 