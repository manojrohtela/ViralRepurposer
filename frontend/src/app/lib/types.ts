export interface ShortScript {
  title: string;
  timestamp: string;
  viralHook: string;
  script: string;
  whyItWorks: string;
}

export interface ViralContentResponse {
  videoUrl: string;
  transcriptItems: number;
  shortsScripts: ShortScript[];
  linkedinPost: string;
  twitterThread: string[];
}
