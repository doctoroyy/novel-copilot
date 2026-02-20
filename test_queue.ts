import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:8787';

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
    console.log('--- E2E Queue Test ---');

    // 1. Register a test user
    console.log('1. Registering test user...');
    const username = `u_${Date.now().toString().slice(-8)}`;
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username,
            password: 'password123',
            invitationCode: 'novel2029' // Default init script adds this code
        })
    });
    const regData = await regRes.json() as any;
    if (!regData.success && regData.error !== '用户名已存在' && regData.error !== '无效的邀请码') {
        console.error('Registration failed:', regData);
        return;
    }

    // 2. Login
    console.log('2. Logging in...');
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: 'password123' })
    });
    const loginData = await loginRes.json() as any;
    if (!loginData.success) {
        console.error('Login failed, creating without invitation code... fallback to manual db injection if needed.', loginData);
        return;
    }
    const token = loginData.token;
    console.log('Token acquired!');

    // 3. Create a Project
    const projectName = `testproject_${Date.now()}`;
    console.log(`3. Creating project: ${projectName}...`);
    const projRes = await fetch(`${BASE_URL}/api/projects`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            name: projectName,
            bible: 'This is a test bible. The protagonist is testing a queue system. He must overcome the queue to win.',
            totalChapters: 3
        })
    });
    const projData = await projRes.json() as any;
    if (!projData.success) {
        console.error('Project creation failed:', projData);
        return;
    }
    console.log('Project created!');

    // 4. Trigger Background Generation (The real test!)
    console.log('4. Submitting 1 chapter for generation to the Queue...');
    const genRes = await fetch(`${BASE_URL}/api/projects/${projectName}/generate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'x-custom-provider': 'gemini',
            'x-custom-model': 'gemini-1.5-flash',
            'x-custom-api-key': 'test-fake-key-for-queue' // It will fail the API call but should successfully hit the queue
        },
        body: JSON.stringify({ chaptersToGenerate: 1 }) // Generate 1 chapter
    });

    const genData = await genRes.json() as any;
    console.log('Generate API Response:', genData);
    if (!genData.success) {
        console.error('Generation Failed with 500:', genData);
        // Wait briefly for wrangler logs to flush
        await delay(2000);
        return;
    }

    // 5. Poll the active-tasks endpoint to observe queue processing
    console.log('5. Polling for background task status...');
    for (let i = 0; i < 15; i++) {
        await delay(2000);
        const taskRes = await fetch(`${BASE_URL}/api/projects/${projectName}/active-task`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const taskData = await taskRes.json() as any;
        if (taskData.success && taskData.task) {
            console.log(`Polling [${i}]: Status = ${taskData.task.status}, Msg = ${taskData.task.currentMessage}`);
            if (taskData.task.status === 'completed' || taskData.task.status === 'failed') {
                console.log('Task finished in background. Queue integration works!');
                return;
            }
        } else {
            console.log(`Polling [${i}]: No active task found yet or error.`, taskData);
        }
    }

    console.log('Test complete. Check wrangler tail logs.');
}

runTest().catch(console.error);
