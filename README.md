# Parallel LLM Processor

A CLI tool for processing multiple LLM prompts in parallel using OpenRouter API with Bun runtime. OpenRouter provides access to 400+ AI models through a single API, including GPT, Claude, Gemini, Llama, and many more.

## Features

- 🚀 **Parallel Processing**: Run multiple prompts simultaneously with configurable concurrency
- 🔄 **Dynamic Model Discovery**: Automatically fetch and select from 300+ available models
- 🎯 **Smart Model Selection**: Popular models highlighted, with real-time pricing and context info
- ⚙️ **Configurable Settings**: Adjust temperature, max tokens, thinking mode, and other parameters
- 📁 **Flexible Input**: Process `.txt`, `.md`, or extensionless files as prompts
- 📊 **Detailed Results**: Get comprehensive processing statistics and error reporting
- 🎨 **Beautiful CLI**: Interactive prompts with colorful output and progress indicators
- 🔑 **API Key Validation**: Test API keys before processing begins
- 📋 **CSV Processing**: Process CSV data with prompt templates for dynamic content generation
- 🔗 **File Combination**: Combine multiple files (including JSON) into a single CSV for analysis

## Installation

Make sure you have [Bun](https://bun.sh) installed, then:

```bash
bun install
```

## Quick Start

1. **Get an OpenRouter API key**: Sign up at [OpenRouter](https://openrouter.ai) and get your API key

2. **Set your API key** (optional):
   ```bash
   export OPENROUTER_API_KEY=your-api-key-here
   ```

3. **Create example prompts**:
   ```bash
   bun prompt init
   ```

4. **Process the prompts**:
   ```bash
   bun prompt run
   ```

## Usage

### Initialize Example Prompts

Create a directory with example prompt files:

```bash
bun prompt init -d ./my-prompts
```

### Process Prompts

Run the interactive CLI to process prompts:

```bash
bun prompt run
```

The CLI will:
1. Test your API key
2. Fetch all available models from OpenRouter (300+)
3. Show popular models first for easy selection
4. Configure model parameters interactively
5. Process all prompts in parallel

Or use command line options:

```bash
bun prompt run \
  --directory ./prompts \
  --api-key your-api-key \
  --model anthropic/claude-3.5-sonnet \
  --concurrent 5
```

### Process CSV Data with Templates

Process a CSV file where each row becomes variables in a prompt template:

```bash
bun prompt csv \
  --csv ./data.csv \
  --template ./template.txt \
  --output ./results \
  --id-column name
```

**Example CSV** (`data.csv`):
```csv
name,age,profession,location
Alice Johnson,28,Software Engineer,San Francisco
Bob Smith,35,Data Scientist,New York
```

**Example Template** (`template.txt`):
```
Write a professional LinkedIn summary for:

Name: {{name}}
Age: {{age}}
Profession: {{profession}}
Location: {{location}}

Make it engaging and highlight their expertise.
```

This will process each CSV row, substitute variables in the template, and generate individual result files.

### Combine Files into CSV

Combine multiple files in a directory into a single CSV:

```bash
bun prompt combine \
  --directory ./json_files \
  --output ./combined_data.csv \
  --metadata
```

Features:
- **JSON Parsing**: Automatically parses JSON files and extracts keys as columns
- **Mixed File Types**: Handles JSON, text, and other file types
- **Metadata**: Optional file metadata (size, dates) inclusion
- **Schema Merging**: Combines different JSON schemas intelligently

### Context-aware Processing

Process a single prompt with other files as context:

```bash
bun prompt context --directory ./my_project
```

### Command Line Options

#### Global Options
- `-k, --api-key <key>`: OpenRouter API key
- `-m, --model <model>`: Model to use (must be available on OpenRouter)
- `--concurrent <number>`: Number of concurrent requests (default: 3)

#### Command-specific Options

**`run` command:**
- `-d, --directory <path>`: Directory containing prompt files

**`csv` command:**
- `-c, --csv <path>`: Path to CSV file
- `-t, --template <path>`: Path to prompt template file
- `-o, --output <dir>`: Output directory for results
- `-i, --id-column <column>`: Column to use as identifier for output files

**`combine` command:**
- `-d, --directory <path>`: Source directory containing files to combine
- `-o, --output <path>`: Output CSV file path
- `-m, --metadata`: Include file metadata (size, dates)

**`init` command:**
- `-d, --directory <path>`: Directory to create examples in (default: ./prompts)

**`context` command:**
- `-d, --directory <path>`: Directory containing prompt and context files

## Available Models

The tool automatically fetches all available models from OpenRouter, including:

### 🔥 Popular Models
- **Claude 3.5 Sonnet** - Anthropic's most capable model
- **GPT-4o** - OpenAI's flagship multimodal model
- **GPT-4o Mini** - Fast and cost-effective
- **o1-preview** - OpenAI's reasoning model
- **Gemini Pro 1.5** - Google's advanced model
- **Llama 3.2 90B** - Meta's open-source model
- **Qwen 2.5 72B** - Alibaba's multilingual model
- **And many more...**

### Dynamic Features
- **Real-time Pricing**: See cost per token for each model
- **Context Length**: View maximum context window size
- **Model Validation**: Automatically verify model availability
- **Smart Filtering**: Popular models highlighted for easy selection

## File Structure

The tool processes files in the specified directory:

```
prompts/
├── prompt1.txt          # Input prompt
├── prompt1_result.txt   # Generated result
├── prompt2.md           # Markdown prompt
├── prompt2_result.txt   # Generated result
└── analysis             # Extensionless file
└── analysis_result.txt
```

## Configuration

The CLI will interactively ask for:

1. **Directory**: Path to folder containing prompt files
2. **API Key**: OpenRouter API key (or use environment variable)
3. **Model**: Choose from 300+ available models with live pricing
4. **Model Settings**:
   - Temperature (0.0-2.0)
   - Max tokens
   - Top P (0.0-1.0)
   - Thinking/reasoning mode (for supported models)

## Examples

### Example Prompt Files

**creative_story.txt**:
```
Write a short creative story about a robot who discovers they can dream. The story should be engaging and thought-provoking, exploring themes of consciousness and identity.
```

**code_review.txt**:
```
Review the following Python code and suggest improvements:

def calculate_average(numbers):
    total = 0
    for i in range(len(numbers)):
        total = total + numbers[i]
    avg = total / len(numbers)
    return avg
```

### Expected Output

```
✅ Using OpenRouter API key from environment
✅ Fetched 347 available models

🔥 Popular Models
❯ anthropic/claude-3.5-sonnet (200k ctx) - $0.000003/$0.000015
  openai/gpt-4o (128k ctx) - $0.000005/$0.000015
  openai/gpt-4o-mini (128k ctx) - $0.000000/$0.000001
  openai/o1-preview (128k ctx) - $0.000015/$0.000060

📊 Results Summary:
  Total files: 4
  Successful: 4
  Failed: 0
  Total time: 8234ms
  Average time per request: 2058ms
  Provider: OpenRouter
```

## Environment Variables

Set your OpenRouter API key:

```bash
export OPENROUTER_API_KEY=your-openrouter-key
```

You can also copy `env.example` to `.env` and set your keys there.

## Error Handling

The tool handles various error scenarios:
- Invalid API keys (tested before processing)
- Network timeouts
- Rate limiting
- Model unavailability
- Malformed prompt files
- Directory access issues

All errors are reported with detailed messages and timing information.

## Why OpenRouter?

- **300+ Models**: Access to the largest collection of AI models
- **Single API**: One key for GPT, Claude, Gemini, Llama, and more
- **Competitive Pricing**: Often better rates than direct provider APIs
- **Model Routing**: Automatic fallbacks and load balancing
- **Real-time Availability**: Always up-to-date model listings

## Development

```bash
# Run in development mode
bun run dev

# Build for production
bun run build

# Run built version
bun run start
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details. 