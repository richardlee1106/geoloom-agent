import { config as loadEnv } from 'dotenv';
import OpenAI from 'openai';

loadEnv({ path: '.env' });
loadEnv({ path: '.env.v4', override: true });
loadEnv({ path: 'backend/.env', override: true });

const API_KEY = process.env.LLM_API_KEY || process.env.XFYUN_API_KEY || '';
const BASE_URL = process.env.LLM_BASE_URL || process.env.XFYUN_BASE_URL || 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2';
const MODEL_ID = process.env.LLM_MODEL || process.env.XFYUN_MODEL || 'astron-code-latest';

const client = new OpenAI({
  apiKey: API_KEY,
  baseURL: BASE_URL,
});

async function testDirectOutput(question, extraParams = {}) {
  console.log(`\n========== 测试直接输出模式 ==========`);
  console.log(`问题: ${question}`);
  
  try {
    const response = await client.chat.completions.create({
      model: MODEL_ID,
      messages: [
        { role: 'user', content: question }
      ],
      temperature: 0.7,
      max_tokens: 4096,
      extra_body: {
        ...extraParams
      }
    });

    const message = response.choices[0].message;
    console.log('\n完整响应:', JSON.stringify(message, null, 2));
    console.log('\n内容:', message.content);
    
    // 检查是否有 reasoning_content 字段（思考推理的内容）
    if (message.reasoning_content && message.reasoning_content.length > 0) {
      console.log('\n🧠 检测到思考推理内容:', message.reasoning_content);
    } else {
      console.log('\n✅ 无思考推理内容');
    }
    
    // 检查 plugins_content
    if (message.plugins_content) {
      console.log('\n🔌 检测到插件内容:', JSON.stringify(message.plugins_content, null, 2));
    }
    
  } catch (error) {
    console.error('请求出错:', error.message);
    if (error.response) {
      console.error('错误响应:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

async function main() {
  if (!API_KEY) {
    throw new Error('缺少 LLM_API_KEY 或 XFYUN_API_KEY');
  }

  console.log('讯飞 coding upstream 直接输出模式测试');
  console.log('URL:', BASE_URL);
  console.log('模型:', MODEL_ID);
  
  await testDirectOutput('计算 1+1 等于多少？');
  await testDirectOutput('小明有5个苹果，吃了2个，又买了3个，现在有几个？请直接给出答案。');
  await testDirectOutput('用 Python 写一个计算斐波那契数列的函数。');
  await testDirectOutput('解释什么是量子计算？', { search_disable: true });
}

main().catch(console.error);
