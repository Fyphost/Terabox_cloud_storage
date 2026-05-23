import { create } from 'zustand';

interface IngestState {
  url: string;
  isAnalyzing: boolean;
  error: string | null;
  setUrl: (url: string) => void;
  setAnalyzing: (v: boolean) => void;
  setError: (e: string | null) => void;
  reset: () => void;
}

export const useIngestStore = create<IngestState>((set) => ({
  url: '',
  isAnalyzing: false,
  error: null,
  setUrl: (url) => set({ url }),
  setAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  setError: (error) => set({ error }),
  reset: () => set({ url: '', isAnalyzing: false, error: null }),
}));
