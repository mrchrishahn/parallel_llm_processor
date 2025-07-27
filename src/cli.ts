#!/usr/bin/env bun

import { Command } from "commander";
import inquirer from "inquirer";
import { Separator } from "@inquirer/prompts";
import fileSelector from "inquirer-file-selector";
import search from "@inquirer/search";
import chalk from "chalk";
import ora from "ora";
import { LLMProcessor } from "./processor.ts";
import { OpenRouterAPI } from "./openrouter.ts";
import type { ProcessConfig, ModelConfig, OpenRouterModel } from "./types.ts";
import { formatDuration, } from "./utils.ts";

const program = new Command();
let modelCache: OpenRouterModel[] = [];

program
  .name("llm-process")
  .description("Process multiple LLM prompts in parallel")
  .version("1.0.0");

program
  .command("run")
  .description("Run prompts in a directory")
  .option("-d, --directory <path>", "Directory containing prompt files")
  .option("-k, --api-key <key>", "OpenRouter API key")
  .option("-m, --model <model>", "Model to use")
  .option("-c, --concurrent <number>", "Number of concurrent requests", "3")
  .action(async (options) => {
    try {
      const config = await getConfiguration(options);
      await runProcessor(config);
    } catch (error) {
      console.error(
        chalk.red("Error:"),
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

program
  .command("init")
  .description("Create example prompt files")
  .option(
    "-d, --directory <path>",
    "Directory to create examples in",
    "./prompts"
  )
  .action(async (options) => {
    await createExamplePrompts(options.directory);
  });

program
  .command("context")
  .description("Run a single prompt with other files as context")
  .option(
    "-d, --directory <path>",
    "Directory to create examples in",
    undefined
  )
  .action(async (options) => {
    try {
      const config = await getConfiguration(options);
      await runContextualProcessor(config, config.directory);
    } catch (error) {
      console.error(
        chalk.red("Error:"),
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

async function getConfiguration(options: any): Promise<ProcessConfig> {
  const questions: any[] = [];

  let directory = options.directory;

  if (!directory) {
    directory = await fileSelector({
      message: "Select the directory containing prompt files:",
      type: "directory",
      filter: (stats) => stats.isDirectory(),
    });
  }

  // API Key - check environment variable first
  let apiKey = options.apiKey;
  if (!apiKey) {
    const envKey = process.env.OPENROUTER_API_KEY;
    if (envKey) {
      apiKey = envKey;
      console.log(chalk.green("✅ Using OpenRouter API key from environment"));
    } else {
      questions.push({
        type: "password",
        name: "apiKey",
        message: "Enter your OpenRouter API key:",
        mask: "*",
      });
    }
  }

  const basicAnswers = await inquirer.prompt(questions);
  const finalApiKey = apiKey || basicAnswers.apiKey;

  // Test API key and fetch models
  const spinner = ora("Fetching available models from OpenRouter...").start();

  try {
    const openRouterAPI = new OpenRouterAPI(finalApiKey);

    // Test API key
    const isValidKey = await openRouterAPI.testApiKey();
    if (!isValidKey) {
      spinner.fail("Invalid API key");
      throw new Error(
        "Invalid OpenRouter API key. Please check your key and try again."
      );
    }

    // Fetch available models
    if (modelCache.length === 0) {
      spinner.text = "Fetching available models from OpenRouter...";
      modelCache = await openRouterAPI.fetchAvailableModels();
      spinner.succeed(`Fetched ${modelCache.length} available models`);
    } else {
      spinner.succeed(`Using cached models (${modelCache.length} available)`);
    }

    const availableModels = modelCache;

    // Model selection
    let selectedModelId = options.model;
    if (!selectedModelId) {
      selectedModelId = await selectModel(availableModels, openRouterAPI);
    }

    const selectedModel = availableModels.find(
      (model) => model.id === selectedModelId
    );

    if (!selectedModel) {
      console.log(chalk.red(`Error: Model "${selectedModelId}" not found.`));
      process.exit(1);
    }

    // Model configuration
    const modelSettings = await getModelConfiguration(selectedModel);

    return {
      directory: directory,
      apiKey: finalApiKey,
      concurrent: parseInt(options.concurrent, 10),
      model: selectedModel,
      modelConfig: {
        model: selectedModel.id,
        ...modelSettings.modelConfig,
      },
      webSearch: modelSettings.webSearch,
      reasoningLevel: modelSettings.reasoningLevel,
    };
  } catch (error) {
    spinner.fail("Failed to fetch models");
    throw error;
  }
}

async function selectModel(
  availableModels: OpenRouterModel[],
  openRouterAPI: OpenRouterAPI
): Promise<string> {
  const popularModels = OpenRouterAPI.getPopularModels();

  return search({
    message: "Select a model (type to search):",
    source: (input) => {
      const allItems = availableModels.map((model) => ({
        name: openRouterAPI.formatModelForDisplay(model),
        value: model.id,
        description: model.description,
      }));

      if (!input) {
        const popularAvailable = allItems.filter((item) =>
          popularModels.includes(item.value)
        );
        const otherModels = allItems.filter(
          (item) => !popularModels.includes(item.value)
        );
        return [
          new Separator("🔥 Popular Models"),
          ...popularAvailable,
          new Separator("📋 All Other Models"),
          ...otherModels,
        ];
      }

      return allItems.filter((item) =>
        item.value.toLowerCase().includes(input.toLowerCase())
      );
    },
  });
}

async function getModelConfiguration(model: OpenRouterModel): Promise<{
  modelConfig: Partial<ModelConfig>;
  webSearch?: boolean;
  reasoningLevel?: "low" | "medium" | "high";
}> {
  const supportedParams = model.supported_parameters || [];

  const questions: any[] = [
    {
      type: "confirm",
      name: "webSearch",
      message: "Enable web search?",
      default: false,
    },
    {
      type: "confirm",
      name: "reasoning",
      message: "Enable thinking/reasoning mode?",
      default: false,
      when: () => supportedParams.includes("reasoning"),
    },
    {
      type: "list",
      name: "reasoningLevel",
      message: "Reasoning / Search context size:",
      choices: ["off", "low", "medium", "high"],
      default: "off",
      when: (answers: any) => answers.webSearch,
    },
    {
      type: "confirm",
      name: "customizeSettings",
      message: "Customize advanced model settings (temperature, tokens, etc.)?",
      default: false,
    },
    {
      type: "number",
      name: "temperature",
      message: "Temperature (0.0-2.0):",
      default: 0.7,
      when: (answers: any) =>
        answers.customizeSettings && supportedParams.includes("temperature"),
    },
    {
      type: "number",
      name: "maxTokens",
      message: "Max tokens (optional):",
      default: 4000,
      when: (answers: any) =>
        answers.customizeSettings && supportedParams.includes("max_tokens"),
    },
    {
      type: "number",
      name: "topP",
      message: "Top P (0.0-1.0):",
      default: 1.0,
      when: (answers: any) =>
        answers.customizeSettings && supportedParams.includes("top_p"),
    },
  ];

  const answers = await inquirer.prompt(questions);

  const modelConfig: Partial<ModelConfig> = {
    temperature: answers.temperature,
    maxTokens: answers.maxTokens,
    topP: answers.topP,
  };

  if (answers.reasoning) {
    (modelConfig as any).reasoning = true;
  }

  return {
    modelConfig,
    webSearch: answers.webSearch,
    reasoningLevel:
      answers.reasoningLevel !== "off" ? answers.reasoningLevel : undefined,
  };
}

async function runProcessor(config: ProcessConfig): Promise<void> {
  const spinner = ora("Initializing LLM processor...").start();

  try {
    const processor = new LLMProcessor(config);

    spinner.text = "Finding prompt files...";
    const promptFiles = await processor.findPromptFiles(config.directory);

    if (promptFiles.length === 0) {
      spinner.fail(`No prompt files found in ${config.directory}`);
      return;
    }

    spinner.succeed(`Found ${promptFiles.length} prompt files`);

    console.log(chalk.blue("\nConfiguration:"));
    console.log(`  Directory: ${config.directory}`);
    console.log(`  Model: ${config.modelConfig.model}`);
    console.log(`  Concurrent requests: ${config.concurrent}`);
    console.log(
      `  Temperature: ${config.modelConfig.temperature ?? "default"}`
    );
    console.log(`  Max tokens: ${config.modelConfig.maxTokens ?? "default"}`);
    console.log(`  Provider: OpenRouter`);

    const confirmRun = await inquirer.prompt([
      {
        type: "confirm",
        name: "proceed",
        message: "Proceed with processing?",
        default: true,
      },
    ]);

    if (!confirmRun.proceed) {
      console.log(chalk.yellow("Operation cancelled."));
      return;
    }

    const processingSpinner = ora("Processing prompts...").start();

    const startTime = Date.now();
    const results = await processor.processAll();
    const totalTime = Date.now() - startTime;

    processingSpinner.succeed("Processing completed!");

    // Display results
    console.log(chalk.green("\n📊 Results Summary:"));
    console.log(`  Total files: ${results.length}`);
    console.log(`  Successful: ${results.filter((r) => r.success).length}`);
    console.log(`  Failed: ${results.filter((r) => !r.success).length}`);
    console.log(`  Total time: ${totalTime}ms`);
    console.log(
      `  Average time per request: ${Math.round(totalTime / results.length)}ms`
    );
    const totalCost = results.reduce((acc, r) => acc + (r.cost || 0), 0);
    console.log(`  Total cost: $${totalCost.toFixed(6)}`);

    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      console.log(chalk.red("\n❌ Failed files:"));
      failures.forEach((failure) => {
        console.log(`  ${failure.file}: ${failure.error}`);
      });
    }

    const successes = results.filter((r) => r.success);
    if (successes.length > 0) {
      console.log(chalk.green("\n✅ Successful files:"));
      successes.forEach((success) => {
        const costString = success.cost ? ` ($${success.cost.toFixed(6)})` : "";
        console.log(
          `  ${success.file} (${formatDuration(success.duration)})${costString}`
        );
      });
    }
  } catch (error) {
    spinner.fail("Processing failed");
    throw error;
  }
}

async function createExamplePrompts(directory: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");

  try {
    await mkdir(directory, { recursive: true });

    const examples = [
      {
        name: "creative_story.txt",
        content:
          "Write a short creative story about a robot who discovers they can dream. The story should be engaging and thought-provoking, exploring themes of consciousness and identity.",
      },
      {
        name: "code_review.txt",
        content: `Review the following Python code and suggest improvements:

def calculate_average(numbers):
    total = 0
    for i in range(len(numbers)):
        total = total + numbers[i]
    avg = total / len(numbers)
    return avg

numbers = [1, 2, 3, 4, 5]
result = calculate_average(numbers)
print("Average:", result)`,
      },
      {
        name: "business_analysis.txt",
        content:
          "Analyze the potential market opportunities for AI-powered personal productivity tools in 2024. Consider target demographics, competitive landscape, and potential challenges.",
      },
      {
        name: "technical_explanation.txt",
        content:
          "Explain how blockchain technology works in simple terms that a non-technical person could understand. Include the key concepts of decentralization, cryptographic hashing, and consensus mechanisms.",
      },
    ];

    const writePromises = examples.map((example) =>
      writeFile(`${directory}/${example.name}`, example.content, "utf-8")
    );

    await Promise.all(writePromises);

    console.log(
      chalk.green(
        `✅ Created ${examples.length} example prompts in ${directory}/`
      )
    );
    console.log(chalk.blue("\nExample files created:"));
    examples.forEach((example) => {
      console.log(`  📄 ${example.name}`);
    });
    console.log(
      chalk.yellow(
        `\nRun 'bun run src/cli.ts run -d ${directory}' to process these prompts!`
      )
    );
  } catch (error) {
    console.error(chalk.red("Failed to create examples:"), error);
    throw error;
  }
}

async function runContextualProcessor(
  config: ProcessConfig,
  directory: string
) {
  const spinner = ora("Initializing contextual processor...").start();
  try {
    const processor = new LLMProcessor(config);

    spinner.text = "Finding prompt and context files...";
    const allFiles = await processor.findPromptFiles(directory);

    if (allFiles.length === 0) {
      spinner.fail(`No prompt files found in ${directory}`);
      return;
    }
    spinner.succeed(`Found ${allFiles.length} potential prompt/context files.`);

    // Ask user to select the main prompt
    const mainPromptPath = await fileSelector({
      message: "Select the main prompt to execute:",
      type: "file",
      basePath: directory,
      filter: (stats) => stats.isFile(),
    });

    const mainPromptFile = allFiles.find(
      (file) => file.path === mainPromptPath
    )!;
    const contextFiles = allFiles.filter(
      (file) => file.path !== mainPromptPath
    );

    spinner.text = "Processing prompt with context...";
    const startTime = Date.now();
    const result = await processor.processContextualPrompt(
      mainPromptFile,
      contextFiles,
      config
    );
    const totalTime = Date.now() - startTime;
    spinner.succeed("Processing completed!");

    if (result.success) {
      console.log(chalk.green("\n✅ Prompt processed successfully!"));
      console.log(`  File: ${result.file}`);
      console.log(`  Result saved to: ${mainPromptFile.outputPath}`);
      console.log(`  Duration: ${formatDuration(totalTime)}`);
      if (result.cost) {
        console.log(`  Cost: $${result.cost.toFixed(6)}`);
      }
    } else {
      console.log(chalk.red("\n❌ Processing failed:"));
      console.log(`  File: ${result.file}`);
      console.log(`  Error: ${result.error}`);
    }
  } catch (error) {
    spinner.fail("Contextual processing failed");
    throw error;
  }
}

program
  .command("csv")
  .description("Process CSV data with a prompt template")
  .option("-c, --csv <path>", "Path to CSV file")
  .option("-t, --template <path>", "Path to prompt template file")
  .option("-o, --output <dir>", "Output directory for results")
  .option("-i, --id-column <column>", "Column to use as identifier for output files")
  .option("-k, --api-key <key>", "OpenRouter API key")
  .option("-m, --model <model>", "Model to use")
  .option("--concurrent <number>", "Number of concurrent requests", "3")
  .action(async (options) => {
    try {
      await runCSVProcessor(options);
    } catch (error) {
      console.error(
        chalk.red("Error:"),
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

program
  .command("combine")
  .description("Combine files in a directory into a single CSV")
  .option("-d, --directory <path>", "Source directory containing files to combine")
  .option("-o, --output <path>", "Output CSV file path")
  .option("-m, --metadata", "Include file metadata (size, dates)", false)
  .action(async (options) => {
    try {
      await runFileCombiner(options);
    } catch (error) {
      console.error(
        chalk.red("Error:"),
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

async function runCSVProcessor(options: any): Promise<void> {
  // Get required file paths
  let csvPath = options.csv;
  if (!csvPath) {
    csvPath = await fileSelector({
      message: "Select the CSV file:",
      type: "file",
      filter: (stats) => stats.isFile(),
    });
  }

  let templatePath = options.template;
  if (!templatePath) {
    templatePath = await fileSelector({
      message: "Select the prompt template file:",
      type: "file",
      filter: (stats) => stats.isFile(),
    });
  }

  let outputDirectory = options.output;
  if (!outputDirectory) {
    outputDirectory = await fileSelector({
      message: "Select output directory:",
      type: "directory",
      filter: (stats) => stats.isDirectory(),
    });
  }

  const config = await getConfiguration({ 
    ...options, 
    directory: outputDirectory // Reuse existing config logic
  });

  const spinner = ora("Processing CSV with template...").start();

  try {
    const processor = new LLMProcessor(config);
    
    const startTime = Date.now();
    const results = await processor.processCsvWithTemplate(
      csvPath, 
      templatePath, 
      outputDirectory, 
      options.idColumn
    );
    const totalTime = Date.now() - startTime;

    spinner.succeed("CSV processing completed!");

    // Display results
    console.log(chalk.green("\n📊 CSV Processing Results:"));
    console.log(`  Total rows: ${results.length}`);
    console.log(`  Successful: ${results.filter((r) => r.success).length}`);
    console.log(`  Failed: ${results.filter((r) => !r.success).length}`);
    console.log(`  Total time: ${totalTime}ms`);
    console.log(
      `  Average time per row: ${Math.round(totalTime / results.length)}ms`
    );
    const totalCost = results.reduce((acc, r) => acc + (r.cost || 0), 0);
    console.log(`  Total cost: $${totalCost.toFixed(6)}`);

    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      console.log(chalk.red("\n❌ Failed rows:"));
      failures.forEach((failure) => {
        console.log(`  Row ${failure.rowIndex}: ${failure.error}`);
      });
    }

    const successes = results.filter((r) => r.success);
    if (successes.length > 0) {
      console.log(chalk.green("\n✅ Successful rows:"));
      successes.forEach((success) => {
        const costString = success.cost ? ` ($${success.cost.toFixed(6)})` : "";
        console.log(
          `  Row ${success.rowIndex} -> ${success.file} (${formatDuration(success.duration)})${costString}`
        );
      });
    }
  } catch (error) {
    spinner.fail("CSV processing failed");
    throw error;
  }
}

async function runFileCombiner(options: any): Promise<void> {
  let sourceDirectory = options.directory;
  if (!sourceDirectory) {
    sourceDirectory = await fileSelector({
      message: "Select directory containing files to combine:",
      type: "directory",
      filter: (stats) => stats.isDirectory(),
    });
  }

  let outputPath = options.output;
  if (!outputPath) {
    const defaultName = `combined_files_${new Date().toISOString().split('T')[0]}.csv`;
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "outputPath",
        message: "Enter output CSV file path:",
        default: `./${defaultName}`,
      },
    ]);
    outputPath = answers.outputPath;
  }

  const spinner = ora("Combining files into CSV...").start();

  try {
    // Create a minimal config for the processor (we just need the file combination method)
    const dummyConfig: ProcessConfig = {
      directory: sourceDirectory,
      apiKey: "",
      modelConfig: { model: "" },
      model: {} as any,
    };
    
    const processor = new LLMProcessor(dummyConfig);
    
    await processor.combineFilesToCSV(sourceDirectory, outputPath, options.metadata);
    
    spinner.succeed(`Files combined successfully into ${outputPath}`);
    
    console.log(chalk.green("\n✅ File combination completed!"));
    console.log(`  Source directory: ${sourceDirectory}`);
    console.log(`  Output file: ${outputPath}`);
    console.log(`  Metadata included: ${options.metadata ? 'Yes' : 'No'}`);
    
  } catch (error) {
    spinner.fail("File combination failed");
    throw error;
  }
}

// Check if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse(process.argv);
}
