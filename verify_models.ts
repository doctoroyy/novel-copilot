
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';

// Load .env manually if needed
if (fs.existsSync('.env')) {
    const envConfig = dotenv.parse(fs.readFileSync('.env'));
    for (const k in envConfig) {
        process.env[k] = envConfig[k];
    }
}

async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('No GEMINI_API_KEY found in .env');
        process.exit(1);
    }

    const ai = new GoogleGenAI({ apiKey });
    
    console.log('Listing models...');
    try {
        const response = await ai.models.list();
        // response.models is likely the array
        const models = response.models || [];
        
        console.log(`Found ${models.length} models.`);
        
        const imageModels = models.filter(m => 
            m.name?.includes('imagen') || 
            m.supportedGenerationMethods?.includes('generateImages') ||
            m.supportedGenerationMethods?.includes('predict')
        );

        console.log('--- Image / Predict Models ---');
        imageModels.forEach(m => {
            console.log(`- ${m.name} (${m.displayName})`);
            console.log(`  Methods: ${m.supportedGenerationMethods?.join(', ')}`);
        });

        console.log('--- All Models ---');
        models.forEach(m => {
             console.log(`- ${m.name}`);
        });

    } catch (e) {
        console.error('Error listing models:', e);
    }
}

listModels();
