const BASE_URL = "http://127.0.0.1:7799";

export interface DaemonHealth {
  status: string;
  storage_path: string;
  model: string;
  ollama_base_url: string;
}

export interface SmritiAppConfig {
  storage_mode: "local" | "cloud";
  storage_path: string;
  cloud_endpoint?: string;
  cloud_token?: string;
  llm_provider: "ollama" | "openai" | "anthropic" | "gemini";
  llm_model: string;
  ollama_base_url?: string;
  openai_api_key?: string;
  anthropic_api_key?: string;
  gemini_api_key?: string;
}

export interface MemoryNode {
  id: string;
  content: string;
  room_id: string;
  strength: number;
  status: string;
  visibility: string;
  reflection_level: number;
  created_at: string;
}

export interface PalaceRoom {
  id: string;
  topic: string;
  visibility: string;
}

export interface PalaceGraph {
  memories: MemoryNode[];
  rooms: PalaceRoom[];
  stats: {
    total_memories: number;
    total_rooms: number;
  };
}

export interface RawEpisode {
  id: string;
  content: string;
  timestamp: string;
  salience: number;
}

export interface RecalledMemory {
  id: string;
  content: string;
  strength: number;
  status: string;
}

export interface SmritiStats {
  episode_buffer?: {
    total_episodes: number;
    unconsolidated: number;
  };
  palace?: {
    room_count: number;
    memory_count: number;
    edge_count: number;
    landmark_count: number;
  };
  vector_store?: {
    total_vectors: number;
  };
  [key: string]: unknown;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 1 minute timeout

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `HTTP error ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      console.error(`API Request to ${path} timed out after 1 minute.`);
      throw new Error("Request timed out after 1 minute.");
    }
    console.error(`API Request to ${path} failed:`, error);
    throw error;
  }
}

export const smritiApi = {
  async getHealth(): Promise<DaemonHealth> {
    return request<DaemonHealth>("/api/health");
  },

  async getStats(): Promise<SmritiStats> {
    return request<SmritiStats>("/api/stats");
  },

  async getConfig(): Promise<SmritiAppConfig> {
    return request<SmritiAppConfig>("/api/config");
  },

  async saveConfig(config: SmritiAppConfig): Promise<{ status: string }> {
    return request<{ status: string }>("/api/config", {
      method: "POST",
      body: JSON.stringify(config),
    });
  },

  async getGraph(): Promise<PalaceGraph> {
    return request<PalaceGraph>("/api/graph");
  },

  async getEpisodes(): Promise<RawEpisode[]> {
    const res = await request<{ episodes: RawEpisode[] }>("/api/pending");
    return res.episodes || [];
  },

  async encodeMemory(
    content: string,
    context = "",
    isPrivate = false
  ): Promise<{ status: string; id: string }> {
    return request<{ status: string; id: string }>("/api/encode", {
      method: "POST",
      body: JSON.stringify({
        content,
        context,
        visibility: isPrivate ? "private" : "shared",
      }),
    });
  },

  async recallMemory(query: string): Promise<RecalledMemory[]> {
    return request<RecalledMemory[]>("/api/recall", {
      method: "POST",
      body: JSON.stringify({ query }),
    });
  },

  async consolidate(): Promise<{ status: string; stats: string }> {
    return request<{ status: string; stats: string }>("/api/consolidate", {
      method: "POST",
    });
  },

  async deleteEpisode(id: string): Promise<{ status: string }> {
    return request<{ status: string }>("/api/pending/delete", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
  },

  async editEpisode(id: string, content: string): Promise<{ status: string }> {
    return request<{ status: string }>("/api/pending/edit", {
      method: "POST",
      body: JSON.stringify({ id, content }),
    });
  },
};
