async function testCrawl4AI() {
  const CRAWL4AI_URL = 'http://localhost:11235/crawl';

  try {
    const submitResp = await fetch(CRAWL4AI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        urls: ['https://example.com'],
        priority: 10,
        bypass_cache: false,
      }),
    });

    console.log('Status:', submitResp.status);
    const data = await submitResp.json();
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testCrawl4AI();
