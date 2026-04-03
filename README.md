# Descript Complete MCP Server

Stop manually transcribing audio. Upload recordings, get transcripts, remove filler words, and export edited content — all from your AI assistant.

## What It Does

This MCP server gives your AI assistant full control over Descript: transcription, editing, AI voice (Overdub), collaboration, and export — all via natural language.

## Tools

| Tool | Category | Description |
|------|----------|-------------|
| `transcribe_audio` | Transcription | Submit an audio URL for transcription |
| `transcribe_video` | Transcription | Submit a video URL for transcription |
| `get_transcript` | Transcription | Fetch transcript by share slug (text, JSON, or VTT) |
| `list_transcripts` | Transcription | List recent transcription jobs |
| `create_project` | Projects | Create a new Descript project |
| `list_projects` | Projects | List all projects in your account |
| `get_project` | Projects | Get details for a specific project |
| `delete_project` | Projects | Delete a project permanently |
| `upload_media` | Media | Upload media to a project via URL |
| `get_upload_status` | Media | Check upload/processing job status |
| `remove_filler_words` | Editing | Remove um, uh, like, etc. with AI |
| `remove_silence` | Editing | Remove silent gaps automatically |
| `trim_transcript` | Editing | Edit content via natural language instruction |
| `export_transcript_txt` | Export | Export transcript as plain text |
| `export_transcript_srt` | Export | Export transcript as SRT subtitles |
| `export_video` | Export | Render/export the video |
| `create_overdub` | Overdub | Generate speech with AI voice |
| `list_overdub_voices` | Overdub | List available AI voices |
| `get_project_members` | Collaboration | Get project collaborators |
| `share_project` | Collaboration | Invite a collaborator by email |

## Quick Start

1. Get your Descript API key from your Descript account settings
2. Set `DESCRIPT_API_KEY=your_key_here` in your environment
3. Start the server: `npm start`
4. Connect your MCP client to `http://localhost:8080/mcp`

## Example Workflows

**Transcribe a podcast episode:**
```
transcribe_audio({ url: "https://example.com/episode-42.mp3", project_name: "Episode 42" })
// Returns job_id — poll with get_upload_status until state = "stopped"
// Then get_transcript({ slug: "your-share-slug", format: "text" })
```

**Clean up an interview recording:**
```
remove_filler_words({ project_id: "abc123" })
remove_silence({ project_id: "abc123", threshold_seconds: 0.8 })
export_transcript_txt({ slug: "your-share-slug", include_speakers: true })
```

**Share for review:**
```
share_project({ project_id: "abc123", email: "editor@example.com", role: "editor" })
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DESCRIPT_API_KEY` | Yes | Your Descript API key |
| `PORT` | No | Server port (default: 8080) |

## Health Check

```
GET http://localhost:8080/health
# {"status":"ok","server":"descript-complete","version":"1.0.0"}
```

---

Built with the [MCPize](https://mcpize.com) framework. Powered by [mastermindshq.business](https://mastermindshq.business).
