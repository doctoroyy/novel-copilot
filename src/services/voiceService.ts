
export interface Voice {
    id: string;
    name: string;
    gender: 'male' | 'female' | 'neutral';
    language: string; 
}

export interface IVoiceProvider {
    getVoices(): Promise<Voice[]>;
    generateSpeech(text: string, voiceId: string): Promise<ArrayBuffer>;
}

// Gemini "Persona" Voices
const GEMINI_VOICES: Voice[] = [
    { id: 'Puck', name: 'Puck', gender: 'male', language: 'multilingual' },
    { id: 'Charon', name: 'Charon', gender: 'male', language: 'multilingual' },
    { id: 'Kore', name: 'Kore', gender: 'female', language: 'multilingual' },
    { id: 'Fenrir', name: 'Fenrir', gender: 'male', language: 'multilingual' },
    { id: 'Aoede', name: 'Aoede', gender: 'female', language: 'multilingual' },
];

export class GeminiVoiceProvider implements IVoiceProvider {
    constructor(private apiKey?: string) {}

    async getVoices(): Promise<Voice[]> {
        return GEMINI_VOICES;
    }

    async generateSpeech(text: string, voiceId: string): Promise<ArrayBuffer> {
        if (!this.apiKey) {
             throw new Error("API Key required for Gemini TTS");
        }

        const model = 'gemini-2.5-flash-preview-tts';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
        
        const body = {
            contents: [{
                parts: [{ text: `Please read the following text: "${text}"` }]
            }],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: voiceId || "Puck"
                        }
                    }
                }
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const err = await response.text();
            let errMsg = err;
            try {
                const jsonErr = JSON.parse(err);
                errMsg = jsonErr.error?.message || err;
            } catch(e) {}
            throw new Error(`Gemini TTS Failed: ${response.status} ${errMsg}`);
        }

        const data = await response.json() as any;
        
        // Response structure: candidates[0].content.parts[0].inlineData.data
        const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        
        if (!inlineData || !inlineData.data) {
             throw new Error("No audio data returned from Gemini");
        }
        
        const binaryString = atob(inlineData.data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        return bytes.buffer;
    }
}

// Simple Factory
export function getVoiceProvider(apiKey?: string): IVoiceProvider {
    return new GeminiVoiceProvider(apiKey);
}
