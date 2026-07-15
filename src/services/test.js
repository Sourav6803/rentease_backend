// const { GoogleGenerativeAI } = require('@google/generative-ai');

// async function listAvailableModels() {
//   const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
//   // This requires an additional library
//   // You can use this endpoint: https://generativelanguage.googleapis.com/v1beta/models
//   const response = await fetch(
//     `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`
//   );
//   const data = await response.json();
//   console.log('Available models:', data)
//   console.log('Available models:', data.models.map(m => m.name));
// }

// // Call this to see available models
// listAvailableModels();


const fetch = require('node-fetch')
const { GoogleGenerativeAI } = require('@google/generative-ai')

const GEMINI_KEYS = [
//   "AIzaSyDKo3MP7QqsSaODqtwt-ehMCXTiFDx4Uto",
//   "AIzaSyDP-lrP1FrXxFB-bzHn2lOki_0eMg4lNUA",
//   "AIzaSyAk5PS42rGUf3o2pMV49kPSlgHNHGSin3c",
//   "AIzaSyAlLUrsuhQSmjNKJmDLIsmDaH2qzMue-qU",
//   "AIzaSyBrdKIcu_eUlzRrbXPIb-R9P9KzVcv8qSY",
//   "AIzaSyD6MeGF3ntTKjlUYdPoo7uBIkIV4rmGTQE",
//   "AIzaSyA4RhRfjdqfxDoppLnQey0U4sA-VBGZw58",
//   "AIzaSyDt0c1WFfo7uWhclQqUdN8izzzwvGnVwqE"
'AIzaSyDKo3MP7QqsSaODqtwt-ehMCXTiFDx4Uto',
'AIzaSyDP-lrP1FrXxFB-bzHn2lOki_0eMg4lNUA',
'AIzaSyAk5PS42rGUf3o2pMV49kPSlgHNHGSin3c',
'AIzaSyAlLUrsuhQSmjNKJmDLIsmDaH2qzMue-qU',
'AIzaSyBrdKIcu_eUlzRrbXPIb-R9P9KzVcv8qSY',
'AIzaSyD6MeGF3ntTKjlUYdPoo7uBIkIV4rmGTQE',
'AIzaSyA4RhRfjdqfxDoppLnQey0U4sA-VBGZw58',
'AIzaSyAlLUrsuhQSmjNKJmDLIsmDaH2qzMue-qU',
'AIzaSyDt0c1WFfo7uWhclQqUdN8izzzwvGnVwqE',
'AIzaSyBBU9Uv2h9ZVtwcQW8X0nR26J6EVXZawcA',
'AIzaSyDvzCKA4feFzx0M36eTr-n0Qhc3C4hlMkI',
'AIzaSyCibDSTLfIw0xS6U16KXIeU1IwsDldS0IY',
"AIzaSyBrdKIcu_eUlzRrbXPIb-R9P9KzVcv8qSY",
"AIzaSyBSgl2o3ywvJSu-Y0eR6gdAHr25M3wc1i4",
"AIzaSyA4RhRfjdqfxDoppLnQey0U4sA-VBGZw58",
"AIzaSyCwR_KH8SDlUc7FcaQAYFBvHrt7jmnmDKg",
"AIzaSyCibDSTLfIw0xS6U16KXIeU1IwsDldS0IY",
"AIzaSyBw6pZ1d1XyLdnXM22TFBnnht63R6PntVk",
"AIzaSyDKo3MP7QqsSaODqtwt-ehMCXTiFDx4Uto",
"AIzaSyDP-lrP1FrXxFB-bzHn2lOki_0eMg4lNUA",
"AIzaSyBrdKIcu_eUlzRrbXPIb-R9P9KzVcv8qSY",
"AIzaSyBSgl2o3ywvJSu-Y0eR6gdAHr25M3wc1i4",
"AIzaSyA4RhRfjdqfxDoppLnQey0U4sA-VBGZw58",
"AIzaSyCwR_KH8SDlUc7FcaQAYFBvHrt7jmnmDKg",
"AIzaSyCibDSTLfIw0xS6U16KXIeU1IwsDldS0IY",
"AIzaSyBw6pZ1d1XyLdnXM22TFBnnht63R6PntVk",
"AIzaSyDKo3MP7QqsSaODqtwt-ehMCXTiFDx4Uto",
"AIzaSyDP-lrP1FrXxFB-bzHn2lOki_0eMg4lNUA",
"AIzaSyBXtXRztY40FJSKigH7SfnD1VtRrjMEb0Q",
"AIzaSyAz-XW-7phaW_lfjKl8Vg2yGG2KvVKMPk0",

"AIzaSyAnFlx8OhPm7Suoc7QnO6nxKTZkHdlh7K4",
"AIzaSyAz-XW-7phaW_lfjKl8Vg2yGG2KvVKMPk0",
"AIzaSyA5tD5rJjHVC-aL2ZQB4E7rGtvJXoyyb4w",
"AIzaSyB-bSzNkrlvFTph0oGOR2iBMF1Os2HUzYs",
"AIzaSyDW9IhnZCvbCmHoTgMX1cL-2DHazh0N2Bk",
"AIzaSyCHP4JTXDgJHNNGTm-aZUDz01ZvlOaR7rs",
"AIzaSyAzFZadMQRSWZ-CyMMy7txNT3uA4ZB0dww",
"AIzaSyB24VGsW5el4BHKgtqOBUuE9q3AGI6px0k",
"AIzaSyCyoP83SFZ_Sqf0O61BDTVIXUiIyNUWpuI",
"AIzaSyBXPPrjiyzPbgTgDKTZDAmhHRrAzBHOAv0",
"AIzaSyA4RhRfjdqfxDoppLnQey0U4sA-VBGZw58",
"AIzaSyBSgl2o3ywvJSu-Y0eR6gdAHr25M3wc1i4"
]

const OPENAI_KEY =
  "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"

// async function testGeminiKey(apiKey) {
//   try {
//     const res = await fetch(
//       `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
//     )

//     const data = await res.json()

//     if (data.models) {
//       console.log("✅ Working Gemini Key:", apiKey)
//        console.log('Available models:', data.models.map(m => m.name));
//       return true
//     }

//     console.log("❌ Invalid Gemini Key:", apiKey)
//     return false
//   } catch (error) {
//     console.log("❌ Error Gemini Key:", apiKey)
//     return false
//   }
// }

// async function getWorkingGeminiKey() {
//   for (const key of GEMINI_KEYS) {
//     const isValid = await testGeminiKey(key)

//     if (isValid) {
//       return key
//     }
//   }

//   return null
// }

// async function testOpenAIKey(apiKey) {
//   try {
//     const res = await fetch("https://api.openai.com/v1/models", {
//       headers: {
//         Authorization: `Bearer ${apiKey}`
//       }
//     })

//     const data = await res.json()

//     if (data.data) {
//       console.log("✅ Working OpenAI Key")
//       return true
//     }

//     console.log("❌ Invalid OpenAI Key")
//     return false
//   } catch (error) {
//     console.log("❌ OpenAI Error")
//     return false
//   }
// }

// async function run() {
//   console.log("\nChecking Gemini Keys...\n")

//   const workingGeminiKey = await getWorkingGeminiKey()

//   if (workingGeminiKey) {
//     console.log("\n🎯 Selected Gemini Key:", workingGeminiKey)
//   } else {
//     console.log("\n❌ No Gemini key working")
//   }

//   console.log("\nChecking OpenAI Key...\n")

//   const openaiValid = await testOpenAIKey(OPENAI_KEY)

//   if (openaiValid) {
//     console.log("🎯 OpenAI key working")
//   } else {
//     console.log("❌ OpenAI key not working")
//   }
// }


async function testGeminiKey(apiKey) {
  try {
    // First check if key is valid by listing models
    const listRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    const listData = await listRes.json();

    if (!listData.models) {
      console.log(`❌ ${apiKey.slice(0, 10)}...: Invalid key`);
      return { valid: false, reason: 'Invalid API key', key: apiKey };
    }

    // Now test with a small request to check quota
    const testPrompt = {
      contents: [{
        parts: [{ text: "Say 'ok' in one word." }]
      }]
    };

    const quotaRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPrompt)
      }
    );

    const quotaData = await quotaRes.json();

    if (quotaRes.ok) {
      console.log(`✅ ${apiKey.slice(0, 10)}...: Working and has quota`);
      return { 
        valid: true, 
        hasQuota: true, 
        key: apiKey,
        model: 'gemini-2.0-flash',
        reason: 'OK'
      };
    }

    // Check if it's a quota error
    if (quotaRes.status === 429) {
      const errorMsg = quotaData.error?.message || '';
      const isQuotaExceeded = errorMsg.includes('quota') || errorMsg.includes('rate limit');
      
      if (isQuotaExceeded) {
        console.log(`⚠️ ${apiKey.slice(0, 10)}...: Valid but QUOTA EXCEEDED`);
        return { 
          valid: true, 
          hasQuota: false, 
          key: apiKey,
          reason: 'Quota exceeded',
          details: errorMsg
        };
      }
    }

    // Other errors (billing issues, etc.)
    console.log(`⚠️ ${apiKey.slice(0, 10)}...: Valid but other issue: ${quotaRes.status}`);
    return { 
      valid: true, 
      hasQuota: false, 
      key: apiKey,
      reason: quotaData.error?.message || `HTTP ${quotaRes.status}`,
      status: quotaRes.status
    };

  } catch (error) {
    console.log(`❌ ${apiKey.slice(0, 10)}...: Network error:`, error.message);
    return { valid: false, reason: 'Network error', key: apiKey };
  }
}

// Test all Gemini keys and return working ones
async function getWorkingGeminiKeys() {
  console.log('\n🔍 Testing Gemini Keys...\n');
  
  const results = [];
  for (const key of GEMINI_KEYS) {
    const result = await testGeminiKey(key);
    results.push(result);
    // Small delay to avoid hitting rate limits during testing
    await new Promise(r => setTimeout(r, 500));
  }

  // Separate results by status
  const working = results.filter(r => r.valid && r.hasQuota);
  const quotaExceeded = results.filter(r => r.valid && !r.hasQuota && r.reason === 'Quota exceeded');
  const invalid = results.filter(r => !r.valid);

  console.log('\n📊 Summary:');
  console.log(`✅ Working (with quota): ${working.length} keys`);
  console.log(`⚠️  Quota Exceeded: ${quotaExceeded.length} keys`);
  console.log(`❌ Invalid: ${invalid.length} keys`);

  if (working.length > 0) {
    console.log('\n🎯 Recommended keys to use:');
    working.forEach(k => console.log(`   ${k.key}`));
  }

  return { working, quotaExceeded, invalid };
}

// Test OpenAI key
async function testOpenAIKey(apiKey) {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    const data = await res.json();

    if (data.data) {
      console.log("✅ OpenAI Key: Working");
      return { valid: true, key: apiKey };
    }
    console.log("❌ OpenAI Key: Invalid");
    return { valid: false, key: apiKey, reason: data.error?.message };
  } catch (error) {
    console.log("❌ OpenAI Key: Error", error.message);
    return { valid: false, key: apiKey, reason: error.message };
  }
}

// Main function
async function run() {
  console.log('='.repeat(50));
  console.log('🔑 API KEY DIAGNOSTIC TOOL');
  console.log('='.repeat(50));

  const { working, quotaExceeded } = await getWorkingGeminiKeys();

  if (working.length === 0) {
    console.log('\n⚠️  No Gemini keys with available quota found.');
    if (quotaExceeded.length > 0) {
      console.log(`\n💡 You have ${quotaExceeded.length} key(s) that are valid but quota-exceeded:`);
      quotaExceeded.forEach(k => console.log(`   - ${k.key.slice(0, 15)}... (quota exhausted)`));
    }
    console.log('\n💡 Suggestions:');
    console.log('   1. Wait for quota to reset (usually after 24 hours for free tier)');
    console.log('   2. Enable billing on your Google Cloud project');
    console.log('   3. Use a different model like gemini-2.0-flash (often has higher limits)');
    console.log('   4. Add more API keys to your list');
  }

  if (OPENAI_KEY) {
    console.log('\n' + '='.repeat(50));
    console.log('🔑 Testing OpenAI Key...');
    console.log('='.repeat(50));
    await testOpenAIKey(OPENAI_KEY);
  }

  // Return the first working key if any
  if (working.length > 0) {
    return working[0].key;
  }
  return null;
}



run()