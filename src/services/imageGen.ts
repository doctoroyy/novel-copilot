
import { AIConfig } from './aiClient.js';

export interface ImageGenConfig extends AIConfig {
    imageModel?: string; 
}

export async function generateCharacterImage(
    prompt: string, 
    config: ImageGenConfig
): Promise<string> {
    // 1. Determine Model
    // User requested 'gemini-3-pro-image-preview' explicitly.
    // If not set, fallback to 'imagen-3.0-generate-001' (standard).
    let modelName = config.imageModel;
    if (modelName === 'gemini-3-pro-preview') {
        modelName = 'gemini-3-pro-image-preview';
    } 
    const finalModel = modelName || 'imagen-3.0-generate-001';

    console.log(`[ImageGen] Generating image with model: ${finalModel}`);
    console.log(`[ImageGen] Prompt: ${prompt}`);

    if (!config.apiKey) {
        throw new Error('Missing API Key');
    }

    try {
        // Strategy: 
        // 1. If model name contains 'gemini', assume it's a unified model using :generateContent
        // 2. If model name contains 'imagen', try :predict first (standard for Imagen on Vertex/GenAI)
        // 3. Fallback if needed.

        if (finalModel.includes('gemini')) {
            return await generateWithGenerateContent(finalModel, prompt, config.apiKey);
        } else {
            // Imagen models
            try {
                return await generateWithPredict(finalModel, prompt, config.apiKey);
            } catch (e: any) {
                console.warn(`[ImageGen] :predict failed for ${finalModel}, trying :generateContent fallback...`);
                // Some newer Imagen versions might be unified?
                return await generateWithGenerateContent(finalModel, prompt, config.apiKey);
            }
        }

    } catch (e: any) {
        console.error('[ImageGen] Failed to generate image:', e);
        throw e;
    }
}

async function generateWithPredict(model: string, prompt: string, apiKey: string): Promise<string> {
    // https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
    
    // Imagen payload structure
    const body = {
        instances: [
            { prompt: `(Character Design Concept) ${prompt}, white background, high quality, anime style` }
        ],
        parameters: {
            sampleCount: 1,
            aspectRatio: "1:1" // or "9:16" for characters? "1:1" is safe.
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Create image failed (${res.status}): ${errText}`);
    }

    const data = await res.json() as any;
    // Imagen response: { predictions: [ { bytesBase64Encoded: "..." } ] }
    const b64 = data.predictions?.[0]?.bytesBase64Encoded || data.predictions?.[0]?.bytes;
    
    if (!b64) throw new Error('No image bytes in predict response');
    return `data:image/png;base64,${b64}`;
}

async function generateWithGenerateContent(model: string, prompt: string, apiKey: string): Promise<string> {
    // https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    // Unified payload
    const body = {
        contents: [{
            parts: [{ text: `Generate an image of: (Character Design Concept) ${prompt}, white background, high quality, anime style` }]
        }],
        generationConfig: {
            // responseMimeType: "image/jpeg" ? Some models support this
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`GenerateContent failed (${res.status}): ${errText}`);
    }

    const data = await res.json() as any;
    // content -> parts -> [ { inlineData: { mimeType: "...", data: "..." } } ]
    // OR it might return a text link? 
    // Usually standard unified output returns inlineData for images.
    
    const part = data.candidates?.[0]?.content?.parts?.[0];
    if (part?.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
    
    // Check if it's new "executable code" style or other?
    throw new Error('No inlineData (image) found in generateContent response');
}
