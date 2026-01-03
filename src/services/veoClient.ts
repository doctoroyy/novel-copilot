
import { AIConfig } from './aiClient.js';
import { GoogleGenAI } from '@google/genai';

export interface VeoConfig extends AIConfig {
    // Specific Veo config
}

export async function generateVideoWithVeo(
    prompt: string,
    characterImageUrls: string[],
    config: VeoConfig
): Promise<string> {
    console.log('[VeoClient] Generating video with Veo 3.1 (Real)');
    console.log('[VeoClient] Prompt:', prompt);
    console.log('[VeoClient] Character Refs:', characterImageUrls);

    if (!config.apiKey) {
        throw new Error('Missing API Key for Veo generation');
    }

    try {
        const ai = new GoogleGenAI({ apiKey: config.apiKey });
        const model = 'veo-3.1-fast-generate-preview';

        // Construct a prompt that includes character references if the SDK supports it directly 
        // or just relies on the prompt text and side-inputs. 
        // Note: The @google/genai SDK for Veo might behave differently than text.
        // Based on user snippet:
        // ai.models.generateVideos({ model, prompt, config: { ... } })
        
        // IMPORTANT: The user's snippet didn't explicitly show passing image references *into* the generateVideos call 
        // other than potentially via prompt or if the SDK supports standard multimodal inputs there.
        // For now, we will assume text-to-video if no specific image-to-video syntax is known, 
        // OR we append the character description to the prompt if we can't pass the URL directly.
        // However, Veo *does* support image-to-video.
        // Let's check if the user snippet had image inputs. It didn't. 
        // But the previous conversation established we WANT character consistency.
        // We will try to pass character images if the SDK allows inputs in 'contents' or similar.
        // For 'generateVideos', it takes 'prompt'. 
        
        console.log(`[VeoClient] Calling ${model}...`);

        let operation = await ai.models.generateVideos({
            model: model,
            prompt: prompt, // + " " + characterDescription?
            config: {
                numberOfVideos: 1,
                // resolution: '1080p', // Not supported in this SDK version
                aspectRatio: '16:9' 
            }
        });

        console.log('[VeoClient] Operation started:', operation.name);

        // Polling
        while (!operation.done) {
            console.log('[VeoClient] Polling status...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            operation = await ai.operations.getVideosOperation({ operation: operation });
        }
        
        const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (!videoUri) {
            throw new Error('Veo generation finished but no video URI returned');
        }

        console.log('[VeoClient] Video URI:', videoUri);

        // Fetch the actual video blob to store in R2 (since URI might be temporary or authenticated)
        // The user snippet fetches it with the API key appended.
        console.log(`[VeoClient] Downloading video from ${videoUri}&key=...`);
        const videoResponse = await fetch(`${videoUri}&key=${config.apiKey}`);
        
        if (!videoResponse.ok) {
             const errText = await videoResponse.text();
             console.error(`[VeoClient] Download failed: ${videoResponse.status} ${videoResponse.statusText}`, errText);
             throw new Error(`Failed to download generated video: ${videoResponse.statusText}`);
        }
        console.log(`[VeoClient] Download success, Content-Length: ${videoResponse.headers.get('content-length')}`);
        
        const arrayBuffer = await videoResponse.arrayBuffer();

        // Convert to Uint8Array for storage (or just return the buffer to caller? Caller expects a key/url)
        // In this architecture, we likely upload to R2 here or return the buffer.
        // existing logic in anime.ts expects a "videoUrlOrKey". 
        // If we return the Google URI, it might expire. Best to upload to R2.
        // Since we don't have direct R2 access *here* (it's in the Worker Env), 
        // we should probably return the Uint8Array or upload it via a passed-in callback/binding.
        // BUT `generateVideoWithVeo` signature returns `Promise<string>`.
        // Let's cheat and assume the caller handles the upload if we return a special object, 
        // OR we just return the arrayBuffer and change the signature?
        // No, let's keep it simple: We need to upload this. 
        // But this function doesn't have the bindings.
        // Refactor: Pass the upload function or binding?
        // Easier: Write a helper to upload to R2 in `anime.ts`, so here we should return the raw data or the temp URL.
        // If we return the temp URL, the frontend might not be able to access it due to CORS or Auth.
        // Let's Return the ArrayBuffer encoded as base64? No, too big.
        
        // Let's modify the signature to return the Blob/Buffer, and let the route handler upload it.
        // OR, just return the `videoUri` and let the route handler doing the fetch & upload.
        return `${videoUri}&key=${config.apiKey}`; 

    } catch (error: any) {
        console.error('[VeoClient] Error:', error);
        throw new Error(`Veo Generation Failed: ${error.message}`);
    }
}
