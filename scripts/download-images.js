const fs = require('fs');
const path = require('path');
const https = require('https');

// 1. 定义目标目录
const TARGET_DIR = path.join(__dirname, '..', 'apps', 'web', 'public', 'heroes');
// 2. 官方全英雄数据接口 (Summary)
const SUMMARY_URL = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json';

// 3. 确保目录存在
if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

// 4. 下载单个文件
const downloadFile = (url, dest) => {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Status ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
};

const run = async () => {
  console.log('Fetching champion list from CommunityDragon...');

  // 获取列表
  let data = '';
  await new Promise((resolve, reject) => {
    https.get(SUMMARY_URL, (res) => {
      res.on('data', chunk => data += chunk);
      res.on('end', resolve);
      res.on('error', reject);
    });
  });

  const champions = JSON.parse(data);

  // 过滤规则：
  // 1) id=-1 (None) 的无效项
  // 2) name 以 "Doom Bot " 开头的条目
  // 3) 图片名以 ruby 开头：因为文件名用 alias.toLowerCase()，所以判断 alias.toLowerCase().startsWith('ruby')
  const validChampions = champions.filter((c) => {
    if (c.id === -1) return false;

    const name = typeof c.name === 'string' ? c.name : '';
    if (name.startsWith('Doom Bot ')) return false;

    const aliasLower = typeof c.alias === 'string' ? c.alias.toLowerCase() : '';
    if (aliasLower.startsWith('ruby')) return false;

    return true;
  });

  console.log(`Found ${validChampions.length} champions. Starting download...`);

  let successCount = 0;

  // 并发下载 (10个一组)
  const CHUNK_SIZE = 10;
  for (let i = 0; i < validChampions.length; i += CHUNK_SIZE) {
    const chunk = validChampions.slice(i, i + CHUNK_SIZE);

    await Promise.all(chunk.map(async (champ) => {
      const filename = champ.alias.toLowerCase() + '.png';
      const dest = path.join(TARGET_DIR, filename);

      const url = `https://cdn.communitydragon.org/latest/champion/${champ.alias}/square`;

      try {
        await downloadFile(url, dest);
        successCount++;
        process.stdout.write('.');
      } catch (err) {
        console.error(`\n❌ Failed to download ${champ.name}: ${err.message}`);
      }
    }));
  }

  console.log(`\n\nDownload complete! ${successCount} images saved to ${TARGET_DIR}`);
};

run();
