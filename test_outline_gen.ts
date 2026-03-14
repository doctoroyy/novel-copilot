import { generateVolumeChapters } from './src/generateOutline.ts';
import fs from 'fs';

async function runTest() {
  const bibleData = JSON.parse(fs.readFileSync('/tmp/test_bible.json', 'utf8'));
  const bible = bibleData[0].results[0].bible;

  const outlineData = JSON.parse(fs.readFileSync('/tmp/test_outlines.json', 'utf8'));
  const masterOutline = JSON.parse(outlineData[0].results[0].outline_json);

  const volume = {
    title: '第二卷：皇都风云',
    startChapter: 81,
    endChapter: 160,
    goal: '在皇都被各方势力拉拢和打压，建立属于自己的势力',
    conflict: '皇族内部夺嫡之争，以及与老牌世家的利益冲突',
    climax: '在皇朝级别盛会上夺得魁首，名动天下',
  };

  const aiConfig = {
    provider: 'custom-1772719742120',
    model: 'DeepSeek-V3',
    apiKey: 'sk-ln8DQygJDI3EgNCB202045A900Ef41Cf99D829653fA25911',
    baseUrl: 'https://api.edgefn.net/v1'
  } as any;

  console.log('Testing generateVolumeChapters...');
  try {
    const chapters = await generateVolumeChapters(aiConfig, {
      bible,
      masterOutline,
      volume,
      chapterCount: 80,
      minChapterWords: 2500,
      previousVolumeSummary: '上一卷总结：主角离开了云风城...'
    });
    console.log('SUCCESS! Generated chapters: ', chapters.length);
  } catch (err: any) {
    console.error('FAILED!', err.message);
  }
}

runTest();
