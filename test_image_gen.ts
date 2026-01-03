
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';

// Load .env manually
if (fs.existsSync('.env')) {
    const envConfig = dotenv.parse(fs.readFileSync('.env'));
    for (const k in envConfig) {
        process.env[k] = envConfig[k];
    }
}

async function testImageGen() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('No GEMINI_API_KEY found');
        return;
    }

    const ai = new GoogleGenAI({ apiKey });
    const model = 'gemini-3-pro-image-preview'; // User provided 

    console.log(`Testing image generation with model: ${model}`);

    try {
        const response = await ai.models.generateImages({
            model: model,
            prompt: 'A cute anime character, chibi style',
            config: {
                numberOfImages: 1,
            }
        });

        console.log('Success!');
        console.log('Response keys:', Object.keys(response));
        if (response.generatedImages && response.generatedImages.length > 0) {
            console.log('Generated Image bytes length:', response.generatedImages[0].image?.imageBytes?.length);
        }

    } catch (e: any) {
        console.error('Generation Failed:', e.message);
        console.error('Full Error:', JSON.stringify(e, null, 2));
    }
}

testImageGen();
