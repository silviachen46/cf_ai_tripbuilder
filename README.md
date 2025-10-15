# 🗺️ TripBuilder
The deployed version is LIVE here [https://cf_ai_tripbuilder.silviachen93032.workers.dev/]!
Trip Planner
<img width="1279" height="668" alt="image" src="https://github.com/user-attachments/assets/d17e5b78-d290-4172-8539-7653774519ec" />
Chat
<img width="1280" height="673" alt="image" src="https://github.com/user-attachments/assets/e6096402-8d62-4a7c-90ec-4c78e082b770" />


An AI-powered travel planning application built with Cloudflare Workers, D1 Database, and Groq API.

## ✨ Features

### 📝 Builder
- **AI-Powered Itinerary Generation**: Create detailed day-by-day travel plans using Groq's LLM
- **Drag & Drop Interface**: Rearrange activities by dragging blocks, times auto-adjust
- **Budget Support**: Set trip budgets and get cost-conscious recommendations
- **Customizable Activities**: Add, edit, or remove activity blocks
- **Persistent Storage**: Save and load trips from Cloudflare D1 database

### 💬 Chat
- **Smart Recommendations**: Get personalized destination suggestions based on travel history
- **Context-Aware**: AI analyzes your past trips (tags, time preferences) for better recommendations
- **Chat History**: Maintains conversation history for context
- **Markdown Formatting**: Beautiful formatted responses with structured lists

## 🛠️ Tech Stack

- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **AI**: Groq API (Llama models)
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Build Tool**: Wrangler

## 🚀 Getting Started

### Prerequisites

- Node.js 16+
- Cloudflare account
- Groq API key

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd cf_ai_tripbuilder
```

2. Install dependencies:
```bash
npm install
```

3. Create `.dev.vars` file for local development:
```bash
GROQ_API_KEY=your_groq_api_key_here
```

4. Set up the D1 database:
```bash
# Create database (if not exists)
npx wrangler d1 create tripbuilder-db

# Run schema
npx wrangler d1 execute tripbuilder-db --local --file=workers/schema.sql

# Add budget column (migration)
npx wrangler d1 execute tripbuilder-db --local --command "ALTER TABLE trips ADD COLUMN budget TEXT;"
```

5. Start development server:
```bash
npx wrangler dev
```

6. Open browser and navigate to:
- Homepage: `http://localhost:8787/`
- Builder: `http://localhost:8787/builder`
- Chat: `http://localhost:8787/chat`

## 📁 Project Structure

```
cf_ai_tripbuilder/
├── pages/              # Frontend HTML files
│   ├── index.html     # Landing page
│   ├── builder.html   # Trip builder interface
│   └── chat.html      # Chat interface
├── workers/           # Cloudflare Workers backend
│   ├── index.ts       # Main worker with API handlers
│   ├── schema.sql     # Database schema
│   └── migrations/    # Database migrations
├── .dev.vars         # Local environment variables (not committed)
├── wrangler.toml     # Wrangler configuration
└── package.json      # Dependencies
```

## 🔑 API Endpoints

### Itinerary
- `POST /api/itinerary/generate` - Generate AI itinerary
- `POST /api/itinerary/save` - Save trip to database
- `GET /api/itinerary/load?trip_id=<id>` - Load saved trip
- `GET /api/trips` - List all trips
- `POST /api/trips/delete` - Delete a trip

### Chat
- `POST /api/reco/next-destination` - Get destination recommendations
- `GET /api/chat/messages` - Get chat history

### Diary
- `POST /api/diary/summarize` - Generate travel journal entry

## 🎨 Features in Detail

### Drag & Drop Blocks
- Drag activity blocks to reorder within a day or across days
- Times automatically recalculate based on new positions
- Visual feedback during drag operations

### AI Integration
- **Structured Output**: Uses Groq's JSON schema mode for reliable itinerary generation
- **Context-Aware Chat**: Analyzes user's travel history for personalized recommendations
- **Budget-Conscious**: AI considers budget constraints when suggesting activities

### Database Schema
- `trips` - Trip metadata (title, dates, budget, etc.)
- `trip_days` - Days within each trip
- `blocks` - Individual activities/time blocks
- `chat_messages` - Chat conversation history
- `user_prefs` - User preferences
- `trip_diary` - Travel journal entries

## 🌐 Deployment

1. Update `wrangler.toml` with your account details

2. Deploy to Cloudflare:
```bash
npx wrangler deploy
```

3. Set production environment variables:
```bash
npx wrangler secret put GROQ_API_KEY
```

4. Run migrations on production database:
```bash
npx wrangler d1 execute tripbuilder-db --remote --file=workers/schema.sql
```

## 📝 Environment Variables

Create a `.dev.vars` file for local development:

```
GROQ_API_KEY=your_groq_api_key_here
```

For production, use Wrangler secrets:
```bash
npx wrangler secret put GROQ_API_KEY
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is open source and available under the MIT License.

## 🙏 Acknowledgments

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Groq](https://groq.com/) for fast LLM inference
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/)

