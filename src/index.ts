import express from "express";
import fetch from "node-fetch";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = process.env.PORT || 8080;
const BASE_URL = "https://descriptapi.com/v1";

function getApiKey(): string {
  const key = process.env.DESCRIPT_API_KEY;
  if (!key) throw new Error("DESCRIPT_API_KEY environment variable is required");
  return key;
}

async function descriptFetch(method: string, endpoint: string, body?: object): Promise<any> {
  const key = getApiKey();
  const url = `${BASE_URL}${endpoint}`;

  const opts: any = {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();

  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.message || data?.error || text;
    throw new Error(`Descript API ${res.status}: ${msg}`);
  }
  return data;
}

const server = new McpServer({
  name: "descript-complete",
  version: "1.0.0",
});

// 1. Transcription

server.tool(
  "transcribe_audio",
  "Submit an audio file URL for transcription. Returns a job ID to poll with get_transcript. Example: transcribe_audio({ url: 'https://example.com/podcast.mp3', project_name: 'Episode 42' })",
  {
    url: z.string().url().describe("Public URL of the audio file to transcribe"),
    project_name: z.string().optional().describe("Name for the Descript project (default: 'Audio Transcription')"),
    language: z.string().optional().describe("Language code e.g. 'en', 'es', 'fr' (default: auto-detect)"),
  },
  async ({ url, project_name, language }: { url: string; project_name?: string; language?: string }) => {
    const body: any = {
      project_name: project_name || "Audio Transcription",
      add_media: { audio: { url } },
    };
    if (language) body.language = language;
    const result = await descriptFetch("POST", "/jobs/import/project_media", body);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ job_id: result.job_id, project_id: result.project_id, state: result.job_state }, null, 2) }],
    };
  }
);

server.tool(
  "transcribe_video",
  "Submit a video file URL for transcription. Returns a job ID to poll with get_transcript. Example: transcribe_video({ url: 'https://example.com/interview.mp4', project_name: 'Interview March 2026' })",
  {
    url: z.string().url().describe("Public URL of the video file to transcribe"),
    project_name: z.string().optional().describe("Name for the Descript project (default: 'Video Transcription')"),
    language: z.string().optional().describe("Language code e.g. 'en', 'es', 'fr' (default: auto-detect)"),
  },
  async ({ url, project_name, language }: { url: string; project_name?: string; language?: string }) => {
    const body: any = {
      project_name: project_name || "Video Transcription",
      add_media: { video: { url } },
    };
    if (language) body.language = language;
    const result = await descriptFetch("POST", "/jobs/import/project_media", body);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ job_id: result.job_id, project_id: result.project_id, state: result.job_state }, null, 2) }],
    };
  }
);

server.tool(
  "get_transcript",
  "Fetch the transcript for a published Descript project by its share slug. Example: get_transcript({ slug: 'xYz789', format: 'text' })",
  {
    slug: z.string().describe("Share slug from the Descript share URL (the part after /view/)"),
    format: z.enum(["text", "json", "vtt"]).optional().describe("Output format: 'text' (default), 'json', or 'vtt'"),
  },
  async ({ slug, format }: { slug: string; format?: "text" | "json" | "vtt" }) => {
    const data = await descriptFetch("GET", `/published_projects/${slug}`);
    const fmt = format || "text";
    let output: string;
    if (fmt === "json") {
      output = JSON.stringify(data, null, 2);
    } else if (fmt === "vtt") {
      const segs = data.transcript || [];
      const fmtTime = (secs: number) => {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = (secs % 60).toFixed(3).padStart(6, "0");
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s}`;
      };
      let vtt = "WEBVTT\n\n";
      (Array.isArray(segs) ? segs : []).forEach((s: any, i: number) => {
        const start = s.start_time ?? s.start ?? 0;
        const end = s.end_time ?? s.end ?? start + 1;
        vtt += `${i + 1}\n${fmtTime(start)} --> ${fmtTime(end)}\n${s.text || s.content || ""}\n\n`;
      });
      output = vtt;
    } else {
      const segs = data.transcript;
      if (!segs) {
        output = `No transcript found. Available keys: ${Object.keys(data).join(", ")}`;
      } else if (typeof segs === "string") {
        output = segs;
      } else if (Array.isArray(segs)) {
        output = segs.map((s: any) => {
          const speaker = s.speaker_name || s.speaker || "";
          const text = s.text || s.content || "";
          return speaker ? `${speaker}: ${text}` : text;
        }).join("\n");
      } else {
        output = JSON.stringify(segs, null, 2);
      }
    }
    return { content: [{ type: "text" as const, text: output }] };
  }
);

server.tool(
  "list_transcripts",
  "List recent transcription jobs. Example: list_transcripts({ limit: 5 })",
  {
    limit: z.number().int().min(1).max(100).optional().describe("Max number of jobs to return (default: 10)"),
  },
  async ({ limit }: { limit?: number }) => {
    const data = await descriptFetch("GET", "/jobs");
    const jobs = (data.jobs || data || []).slice(0, limit || 10);
    const summary = jobs.map((j: any) => ({
      job_id: j.job_id,
      type: j.job_type,
      state: j.job_state,
      project_id: j.project_id,
      created_at: j.created_at,
    }));
    return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
  }
);

// 2. Project Management

server.tool(
  "create_project",
  "Create a new Descript project. Example: create_project({ name: 'Podcast Episode 1' })",
  {
    name: z.string().min(1).describe("Name for the new project"),
    description: z.string().optional().describe("Optional project description"),
  },
  async ({ name, description }: { name: string; description?: string }) => {
    const body: any = { project_name: name };
    if (description) body.description = description;
    const result = await descriptFetch("POST", "/projects", body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "list_projects",
  "List all Descript projects in your account. Example: list_projects({ limit: 20 })",
  {
    limit: z.number().int().min(1).max(100).optional().describe("Max projects to return (default: 20)"),
    offset: z.number().int().min(0).optional().describe("Pagination offset (default: 0)"),
  },
  async ({ limit, offset }: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (offset) params.set("offset", String(offset));
    const qs = params.toString() ? `?${params}` : "";
    const data = await descriptFetch("GET", `/projects${qs}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_project",
  "Get details for a specific Descript project. Example: get_project({ project_id: 'abc123' })",
  {
    project_id: z.string().min(1).describe("The Descript project ID"),
  },
  async ({ project_id }: { project_id: string }) => {
    const data = await descriptFetch("GET", `/projects/${project_id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "delete_project",
  "Delete a Descript project permanently. Example: delete_project({ project_id: 'abc123' })",
  {
    project_id: z.string().min(1).describe("The Descript project ID to delete"),
  },
  async ({ project_id }: { project_id: string }) => {
    const data = await descriptFetch("DELETE", `/projects/${project_id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, project_id, ...data }, null, 2) }] };
  }
);

// 3. Media Upload

server.tool(
  "upload_media",
  "Upload media to a Descript project via URL. Example: upload_media({ project_id: 'abc123', url: 'https://example.com/video.mp4', media_name: 'interview' })",
  {
    project_id: z.string().min(1).describe("Target Descript project ID"),
    url: z.string().url().describe("Public URL of the media file"),
    media_name: z.string().optional().describe("Name for the media clip (default: 'video')"),
    media_type: z.enum(["video", "audio"]).optional().describe("Type of media (default: 'video')"),
  },
  async ({ project_id, url, media_name, media_type }: { project_id: string; url: string; media_name?: string; media_type?: "video" | "audio" }) => {
    const name = media_name || "video";
    const type = media_type || "video";
    const body = {
      project_id,
      add_media: { [name]: { url } },
      media_type: type,
    };
    const result = await descriptFetch("POST", "/jobs/import/project_media", body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_upload_status",
  "Check the status of a media upload or processing job. Example: get_upload_status({ job_id: 'job_abc123' })",
  {
    job_id: z.string().min(1).describe("The job ID returned from upload_media or transcribe_audio/video"),
  },
  async ({ job_id }: { job_id: string }) => {
    const data = await descriptFetch("GET", `/jobs/${job_id}`);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          job_id: data.job_id,
          type: data.job_type,
          state: data.job_state,
          project_id: data.project_id,
          progress: data.progress,
          result: data.result,
          created_at: data.created_at,
          stopped_at: data.stopped_at,
        }, null, 2),
      }],
    };
  }
);

// 4. Editing

server.tool(
  "remove_filler_words",
  "Use the Descript AI agent to remove filler words (um, uh, like, you know) from a project transcript. Example: remove_filler_words({ project_id: 'abc123' })",
  {
    project_id: z.string().min(1).describe("The Descript project ID to edit"),
    filler_words: z.array(z.string()).optional().describe("Custom list of filler words to remove (default: common fillers)"),
  },
  async ({ project_id, filler_words }: { project_id: string; filler_words?: string[] }) => {
    const wordList = filler_words?.join(", ") || "um, uh, like, you know, sort of, kind of";
    const prompt = `Remove filler words (${wordList}) from all clips in the timeline`;
    const job = await descriptFetch("POST", "/jobs/agent", { project_id, prompt });
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ job_id: job.job_id, project_id, prompt, state: job.job_state }, null, 2) }],
    };
  }
);

server.tool(
  "remove_silence",
  "Use the Descript AI agent to remove silent gaps from a project. Example: remove_silence({ project_id: 'abc123', threshold_seconds: 0.5 })",
  {
    project_id: z.string().min(1).describe("The Descript project ID to edit"),
    threshold_seconds: z.number().min(0.1).max(10).optional().describe("Minimum silence duration to remove in seconds (default: 0.5)"),
  },
  async ({ project_id, threshold_seconds }: { project_id: string; threshold_seconds?: number }) => {
    const threshold = threshold_seconds || 0.5;
    const prompt = `Remove all silences longer than ${threshold} seconds from the timeline`;
    const job = await descriptFetch("POST", "/jobs/agent", { project_id, prompt });
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ job_id: job.job_id, project_id, prompt, state: job.job_state }, null, 2) }],
    };
  }
);

server.tool(
  "trim_transcript",
  "Use the Descript AI agent to trim or edit content in a project based on a prompt. Example: trim_transcript({ project_id: 'abc123', instruction: 'Remove the first 30 seconds' })",
  {
    project_id: z.string().min(1).describe("The Descript project ID to edit"),
    instruction: z.string().min(1).describe("Natural language instruction for what to trim or edit"),
  },
  async ({ project_id, instruction }: { project_id: string; instruction: string }) => {
    const job = await descriptFetch("POST", "/jobs/agent", { project_id, prompt: instruction });
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ job_id: job.job_id, project_id, instruction, state: job.job_state }, null, 2) }],
    };
  }
);

// 5. Export

server.tool(
  "export_transcript_txt",
  "Export the transcript of a published project as plain text. Example: export_transcript_txt({ slug: 'xYz789' })",
  {
    slug: z.string().describe("Share slug from the Descript share URL"),
    include_speakers: z.boolean().optional().describe("Include speaker names in output (default: true)"),
    include_timestamps: z.boolean().optional().describe("Include timestamps in output (default: false)"),
  },
  async ({ slug, include_speakers, include_timestamps }: { slug: string; include_speakers?: boolean; include_timestamps?: boolean }) => {
    const data = await descriptFetch("GET", `/published_projects/${slug}`);
    const segs = data.transcript;
    if (!segs) return { content: [{ type: "text" as const, text: "No transcript available." }] };

    const lines = (Array.isArray(segs) ? segs : []).map((s: any) => {
      let line = "";
      if (include_timestamps !== false && (s.start_time != null || s.start != null)) {
        const t = s.start_time ?? s.start ?? 0;
        const mins = Math.floor(t / 60);
        const secs = Math.floor(t % 60);
        line += `[${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}] `;
      }
      const speaker = s.speaker_name || s.speaker || "";
      const text = s.text || s.content || "";
      if (include_speakers !== false && speaker) line += `${speaker}: `;
      line += text;
      return line;
    });

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

server.tool(
  "export_transcript_srt",
  "Export the transcript of a published project in SRT subtitle format. Example: export_transcript_srt({ slug: 'xYz789' })",
  {
    slug: z.string().describe("Share slug from the Descript share URL"),
  },
  async ({ slug }: { slug: string }) => {
    const data = await descriptFetch("GET", `/published_projects/${slug}`);
    const segs = data.transcript;
    if (!segs || !Array.isArray(segs)) return { content: [{ type: "text" as const, text: "No transcript segments available." }] };

    const fmtTime = (secs: number) => {
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = Math.floor(secs % 60);
      const ms = Math.round((secs % 1) * 1000);
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
    };

    let srt = "";
    segs.forEach((s: any, i: number) => {
      const start = s.start_time ?? s.start ?? 0;
      const end = s.end_time ?? s.end ?? start + 3;
      srt += `${i + 1}\n${fmtTime(start)} --> ${fmtTime(end)}\n${s.text || s.content || ""}\n\n`;
    });

    return { content: [{ type: "text" as const, text: srt }] };
  }
);

server.tool(
  "export_video",
  "Use the Descript agent to export/render the video for a project. Example: export_video({ project_id: 'abc123', resolution: '1080p' })",
  {
    project_id: z.string().min(1).describe("The Descript project ID to export"),
    resolution: z.enum(["720p", "1080p", "4k"]).optional().describe("Export resolution (default: '1080p')"),
    format: z.enum(["mp4", "mov"]).optional().describe("Export format (default: 'mp4')"),
  },
  async ({ project_id, resolution, format }: { project_id: string; resolution?: string; format?: string }) => {
    const res = resolution || "1080p";
    const fmt = format || "mp4";
    const prompt = `Export the video in ${res} ${fmt} format`;
    const job = await descriptFetch("POST", "/jobs/agent", { project_id, prompt });
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ job_id: job.job_id, project_id, resolution: res, format: fmt, state: job.job_state }, null, 2) }],
    };
  }
);

// 6. Overdub

server.tool(
  "create_overdub",
  "Use Descript Overdub to regenerate or replace speech in a project using AI voice. Example: create_overdub({ project_id: 'abc123', text: 'Hello and welcome back!', voice_id: 'voice_xyz' })",
  {
    project_id: z.string().min(1).describe("The Descript project ID"),
    text: z.string().min(1).describe("The text to generate with Overdub AI voice"),
    voice_id: z.string().optional().describe("Voice ID to use (list available with list_overdub_voices)"),
    start_time: z.number().optional().describe("Timeline position in seconds where the overdub should be inserted"),
  },
  async ({ project_id, text, voice_id, start_time }: { project_id: string; text: string; voice_id?: string; start_time?: number }) => {
    const body: any = { project_id, text };
    if (voice_id) body.voice_id = voice_id;
    if (start_time != null) body.start_time = start_time;
    const result = await descriptFetch("POST", "/overdub", body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "list_overdub_voices",
  "List available Overdub AI voices for your account. Example: list_overdub_voices({})",
  {},
  async () => {
    const data = await descriptFetch("GET", "/overdub/voices");
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  }
);

// 7. Collaboration

server.tool(
  "get_project_members",
  "Get the list of collaborators on a Descript project. Example: get_project_members({ project_id: 'abc123' })",
  {
    project_id: z.string().min(1).describe("The Descript project ID"),
  },
  async ({ project_id }: { project_id: string }) => {
    const data = await descriptFetch("GET", `/projects/${project_id}/members`);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "share_project",
  "Share a Descript project with a collaborator by email. Example: share_project({ project_id: 'abc123', email: 'editor@example.com', role: 'editor' })",
  {
    project_id: z.string().min(1).describe("The Descript project ID to share"),
    email: z.string().email().describe("Email address of the collaborator to invite"),
    role: z.enum(["viewer", "commenter", "editor", "admin"]).optional().describe("Permission level (default: 'editor')"),
    message: z.string().optional().describe("Optional message to include in the invitation email"),
  },
  async ({ project_id, email, role, message }: { project_id: string; email: string; role?: string; message?: string }) => {
    const body: any = { email, role: role || "editor" };
    if (message) body.message = message;
    const result = await descriptFetch("POST", `/projects/${project_id}/members`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// Express server

const app = express();
app.use(express.json());

app.get("/health", (_req: any, res: any) => {
  res.json({ status: "ok", server: "descript-complete", version: "1.0.0" });
});

app.all("/mcp", async (req: any, res: any) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`Descript Complete MCP server running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
