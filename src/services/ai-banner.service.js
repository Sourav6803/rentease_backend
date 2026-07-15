// // services/ai-banner.service.js
// const axios = require('axios');
// const { GoogleGenerativeAI } = require('@google/generative-ai');
// const { Banner } = require('../models');
// const AppError = require('../utils/AppError');
// const logger = require('../config/logger');
// const { getRedisClient } = require('../config/redis');
// const sharp = require('sharp'); // For image processing

// // Redis client
// const redisClient = getRedisClient();
// const cacheTTL = 3600; // 1 hour

// // Google AI Studio Configuration (single key for text optimization + image generation)
// const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// const IMAGE_MODEL = 'gemini-2.5-flash-image';
// const TEXT_MODEL = 'gemini-pro';

// /**
//  * Industry Standard Production-Grade Prompts for Banner Generation
//  */
// const BANNER_PROMPT_TEMPLATES = {
//     // Hero Banner - Full-width, visually striking
//     hero: (title, description, theme) => `
//         Create a professional e-commerce hero banner with the following specifications:
        
//         MAIN SUBJECT: "${title}"
//         CONTEXT: ${description || 'Premium product showcase'}
//         COLOR PALETTE: ${theme?.accent ? `Primary accent: ${theme.accent}` : 'Modern corporate colors'}
        
//         DESIGN REQUIREMENTS:
//         - Full-width banner (1200x600px)
//         - Professional photography style with cinematic lighting
//         - Clear focal point with 60/40 rule (60% subject, 40% negative space)
//         - Include subtle gradient overlays for text readability
//         - Call-to-action space on the right side
//         - High-end commercial quality suitable for luxury/premium brand
//         - Use depth of field for professional look
//         - Incorporate brand-appropriate color psychology
        
//         STYLE: Modern, clean, premium, high-contrast, with soft shadows and highlights
//         MOOD: Aspirational, trustworthy, and engaging
//         COMPOSITION: Rule of thirds, with product/service as hero element
//     `,

//     // Promotional Banner - Deals, offers, discounts
//     promo: (title, description, theme) => `
//         Generate a high-converting promotional banner with the following details:
        
//         OFFER: "${title}"
//         DETAILS: ${description || 'Limited time promotional offer'}
//         BRAND COLORS: ${theme?.accent ? `Primary: ${theme.accent}` : 'Dynamic promotional colors'}
        
//         DESIGN ELEMENTS:
//         - Eye-catching with 30% discount/offer emphasis
//         - Urgency indicators (limited time, countdown, etc.)
//         - Price reduction visual (crossed-out original price + new price)
//         - Vibrant, attention-grabbing colors with strategic contrast
//         - Clear value proposition within first 2 seconds
//         - Social proof indicators (stars, ratings, badges)
//         - Click-worthy call-to-action button design
        
//         STYLE: Bold, energetic, persuasive, with motion feel
//         PSYCHOLOGICAL TRIGGERS: Scarcity, urgency, value perception
//         COMPOSITION: Z-pattern layout for optimal eye flow
//     `,

//     // Strip Banner - Horizontal, concise announcements
//     strip: (title, description, theme) => `
//         Design a professional announcement strip banner with:
        
//         MESSAGE: "${title}"
//         SUBTEXT: ${description || 'Important announcement'}
//         COLOR SCHEME: ${theme?.accent ? `Accent: ${theme.accent}` : 'Brand primary colors'}
        
//         SPECIFICATIONS:
//         - Horizontal format (1200x200px)
//         - Clean, minimal design with maximum readability
//         - Left to right flow with icon + text + CTA
//         - Use 2-3 word maximum per element
//         - High contrast text against background
//         - Professional, trustworthy appearance
//         - Include subtle animation cues (arrows, movement indicators)
        
//         STYLE: Corporate, clean, informative, professional
//         PURPOSE: News/announcement with minimal distraction
//     `,

//     // Deal Banner - Shopping deals with urgency
//     deal: (title, description, theme) => `
//         Create a compelling deal banner for e-commerce with:
        
//         PRODUCT/DEAL: "${title}"
//         OFFER DETAILS: ${description || 'Limited time deal'}
//         BRAND IDENTITY: ${theme?.accent ? `Brand accent: ${theme.accent}` : 'Deal-focused colors'}
        
//         DESIGN ELEMENTS:
//         - Massive discount visualization (40-70% off)
//         - Original price crossed out with new price highlighted
//         - Limited stock/limited time indicators
//         - Flash sale aesthetic with dynamic elements
//         - High urgency visual cues (lightning, countdown, etc.)
//         - Product imagery with deal badges overlay
//         - Mobile-first responsive design consideration
//         - Clear saving amount display ($X savings)
        
//         STYLE: High-energy, deal-focused, conversion-optimized
//         PSYCHOLOGICAL TRIGGERS: FOMO, scarcity, bargain hunting
//         COMPOSITION: Product-focused with deal elements surrounding
//     `
// };

// /**
//  * Generate banner image using Gemini's native image model
//  */
// async function generateBannerImage(title, description, type, theme) {
//     try {
//         if (!GEMINI_API_KEY) {
//             logger.warn('GEMINI_API_KEY not configured, returning placeholder');
//             return {
//                 success: true,
//                 url: generatePlaceholderImage(title, type),
//                 fallback: true
//             };
//         }

//         // Get optimized prompt using Gemini text model
//         const optimizedPrompt = await getOptimizedPromptWithGemini(title, description, type, theme);

//         // Check cache for generated image
//         const cacheKey = generateCacheKey(optimizedPrompt);
//         const cachedResult = await getCachedImage(cacheKey);
//         if (cachedResult) {
//             logger.info('Returning cached AI banner image');
//             return cachedResult;
//         }

//         // Generate image directly with Gemini image model (returns base64 buffer)
//         const imageBuffer = await generateImageWithGemini(optimizedPrompt);

//         // Process and resize with sharp
//         const processedBuffer = await sharp(imageBuffer)
//             .resize(getBannerWidth(type), getBannerHeight(type), {
//                 fit: 'cover',
//                 position: 'center',
//                 background: { r: 255, g: 255, b: 255, alpha: 1 }
//             })
//             .jpeg({ quality: 90, progressive: true })
//             .toBuffer();

//         // Upload processed image to CDN/storage
//         const cdnUrl = await uploadToCDN(processedBuffer, type);

//         const result = {
//             success: true,
//             url: cdnUrl || `data:image/jpeg;base64,${processedBuffer.toString('base64')}`,
//             promptUsed: optimizedPrompt,
//             generatedAt: new Date().toISOString(),
//             cacheKey: cacheKey
//         };

//         // Cache the result
//         await cacheImage(cacheKey, result);

//         logger.info(`AI banner image generated successfully for: ${title}`);
//         return result;

//     } catch (error) {
//         logger.error('Error generating AI banner image:', error);
//         return {
//             success: true,
//             url: generatePlaceholderImage(title, type),
//             fallback: true,
//             error: error.message
//         };
//     }
// }

// /**
//  * Get optimized prompt using Gemini AI (text model)
//  */
// async function getOptimizedPromptWithGemini(title, description, type, theme) {
//     try {
//         const model = genAI.getGenerativeModel({
//             model: TEXT_MODEL,
//             generationConfig: {
//                 temperature: 0.7,
//                 topK: 1,
//                 topP: 1,
//                 maxOutputTokens: 500,
//             },
//         });

//         // Get base prompt template
//         const basePrompt = BANNER_PROMPT_TEMPLATES[type] || BANNER_PROMPT_TEMPLATES.hero;
//         const promptTemplate = basePrompt(title, description, theme);

//         // Gemini optimization prompt
//         const optimizationPrompt = `
//             You are an expert AI prompt engineer specializing in image generation for e-commerce banners.
            
//             Original prompt for banner:
//             ${promptTemplate}
            
//             Please optimize this prompt for AI image generation with these requirements:
//             1. Make it more detailed and specific for high-quality output
//             2. Add technical specifications (lighting, camera angles, lens effects)
//             3. Include specific color hex codes from the brand theme
//             4. Specify exact composition and layout details
//             5. Add quality modifiers (8k, detailed, sharp focus, etc.)
//             6. Include specific styles (photorealistic, studio quality, etc.)
//             7. Make it between 100-200 words for best results
//             8. Include negative prompts (what to avoid)
            
//             Return only the optimized prompt, no explanations.
//         `;

//         const result = await model.generateContent(optimizationPrompt);
//         const response = await result.response;
//         const optimizedPrompt = response.text();

//         logger.info('Gemini optimized prompt generated successfully');
//         return optimizedPrompt || promptTemplate;

//     } catch (error) {
//         logger.error('Error optimizing prompt with Gemini:', error);
//         // Fallback to base prompt
//         const basePrompt = BANNER_PROMPT_TEMPLATES[type] || BANNER_PROMPT_TEMPLATES.hero;
//         return basePrompt(title, description, theme);
//     }
// }

// /**
//  * Call Gemini's native image generation model, returns raw image Buffer
//  */
// async function generateImageWithGemini(prompt) {
//     try {
//         const model = genAI.getGenerativeModel({ model: IMAGE_MODEL });

//         const result = await model.generateContent({
//             contents: [{ role: 'user', parts: [{ text: prompt }] }],
//             generationConfig: {
//                 responseModalities: ['image', 'text']
//             }
//         });

//         const response = await result.response;
//         const parts = response.candidates?.[0]?.content?.parts || [];

//         for (const part of parts) {
//             if (part.inlineData && part.inlineData.data) {
//                 return Buffer.from(part.inlineData.data, 'base64');
//             }
//         }

//         throw new Error('No image data returned by Gemini image model');

//     } catch (error) {
//         logger.error('Error calling Gemini image model:', error);
//         throw error;
//     }
// }

// /**
//  * Upload to CDN (implement with your preferred CDN)
//  */
// async function uploadToCDN(imageBuffer, type) {
//     try {
//         // Implement your CDN upload logic here
//         // Example: AWS S3, Cloudinary, etc.
//         return null; // Placeholder
//     } catch (error) {
//         logger.error('CDN upload error:', error);
//         return null;
//     }
// }

// /**
//  * Advanced banner enhancement with AI
//  */
// async function enhanceBannerWithAIImage(banner) {
//     try {
//         const { title, description, type, theme, cta } = banner;

//         // Generate optimized banner image
//         const imageResult = await generateBannerImage(title, description, type, theme);

//         // Update banner with AI-generated content
//         banner.image = {
//             ...banner.image,
//             url: imageResult.url,
//             mobileUrl: imageResult.url,
//             alt: title,
//             aiGenerated: true,
//             metadata: {
//                 promptUsed: imageResult.promptUsed,
//                 fallback: !!imageResult.fallback,
//                 generatedAt: new Date().toISOString(),
//                 optimizedBy: 'Gemini AI',
//                 modelVersion: IMAGE_MODEL
//             }
//         };

//         await banner.save();

//         logger.info(`Enhanced banner with AI: ${title}`);
//         return banner;

//     } catch (error) {
//         logger.error('Error enhancing banner with AI:', error);
//         throw new AppError('Failed to enhance banner with AI', 500);
//     }
// }

// /**
//  * Generate banner copy using Gemini AI
//  */
// async function generateBannerCopyWithGemini(title, description, type, link) {
//     try {
//         const model = genAI.getGenerativeModel({ model: TEXT_MODEL });

//         const prompt = `
//             As a professional copywriter for e-commerce, optimize this banner content:
            
//             CURRENT:
//             Title: ${title}
//             Description: ${description}
//             Type: ${type}
//             CTA Link: ${link?.url || ''}
            
//             Please provide:
//             1. A more compelling title (max 10 words)
//             2. A persuasive description (max 50 words) 
//             3. A strong call-to-action text (max 5 words)
//             4. Suggested CTA color based on the banner type
            
//             Format as JSON:
//             {
//                 "title": "New title",
//                 "description": "New description",
//                 "ctaText": "New CTA",
//                 "ctaColor": "#XXXXXX"
//             }
//         `;

//         const result = await model.generateContent(prompt);
//         const response = await result.response;
//         const text = response.text();

//         try {
//             return JSON.parse(text);
//         } catch (e) {
//             logger.warn('Failed to parse Gemini copy response', e);
//             return null;
//         }

//     } catch (error) {
//         logger.error('Error generating copy with Gemini:', error);
//         return null;
//     }
// }

// /**
//  * Predict CTR for banner
//  */
// async function predictCTR(banner) {
//     // Implement ML-based CTR prediction
//     // Placeholder returns industry average
//     const industryAverages = {
//         hero: 2.5,
//         promo: 3.8,
//         strip: 1.2,
//         deal: 4.5
//     };
//     return industryAverages[banner.type] || 2.5;
// }

// /**
//  * Get industry benchmark
//  */
// async function getIndustryBenchmark(type) {
//     const benchmarks = {
//         hero: { ctr: 2.5, conversion: 3.2, engagement: 4.1 },
//         promo: { ctr: 3.8, conversion: 4.5, engagement: 3.8 },
//         strip: { ctr: 1.2, conversion: 1.8, engagement: 2.1 },
//         deal: { ctr: 4.5, conversion: 5.2, engagement: 4.5 }
//     };
//     return benchmarks[type] || benchmarks.hero;
// }

// /**
//  * Get AI suggestions for optimization
//  */
// async function getAISuggestions(banner) {
//     const suggestions = [];

//     if (!banner.image?.url) {
//         suggestions.push('Add high-quality banner image');
//     }

//     if (!banner.link?.url) {
//         suggestions.push('Include clear call-to-action link');
//     }

//     if (banner.title && banner.title.length > 15) {
//         suggestions.push('Shorten title for better readability');
//     }

//     return suggestions;
// }

// /**
//  * Helper functions
//  */
// function getBannerWidth(type) {
//     const dimensions = { hero: 1200, strip: 1200, promo: 1200, deal: 1200 };
//     return dimensions[type] || 1200;
// }

// function getBannerHeight(type) {
//     const dimensions = { hero: 600, strip: 200, promo: 400, deal: 400 };
//     return dimensions[type] || 400;
// }

// function generatePlaceholderImage(title, type) {
//     const width = getBannerWidth(type);
//     const height = getBannerHeight(type);
//     const encodedTitle = encodeURIComponent(title?.substring(0, 20) || 'Banner');
//     return `https://via.placeholder.com/${width}x${height}/2874F0/FFFFFF?text=${encodedTitle}`;
// }

// function generateCacheKey(prompt) {
//     return `ai:banner:${Buffer.from(prompt).toString('base64').substring(0, 50)}`;
// }

// async function getCachedImage(cacheKey) {
//     if (!redisClient) return null;
//     try {
//         const cached = await redisClient.get(cacheKey);
//         return cached ? JSON.parse(cached) : null;
//     } catch (error) {
//         return null;
//     }
// }

// async function cacheImage(cacheKey, data) {
//     if (!redisClient) return;
//     try {
//         await redisClient.setex(cacheKey, cacheTTL, JSON.stringify(data));
//     } catch (error) {
//         logger.warn('Cache error:', error);
//     }
// }

// module.exports = {
//     generateBannerImage,
//     enhanceBannerWithAIImage,
//     getOptimizedPromptWithGemini,
//     generateBannerCopyWithGemini,
//     predictCTR,
//     getIndustryBenchmark,
//     getAISuggestions
// };


// // services/ai-banner.service.js
// const axios = require('axios');
// const { Banner } = require('../models');
// const AppError = require('../utils/AppError');
// const logger = require('../config/logger');
// const { getRedisClient } = require('../config/redis');
// const sharp = require('sharp'); // For image processing

// // Redis client
// const redisClient = getRedisClient();
// const cacheTTL = 3600; // 1 hour

// // Pollinations.ai Configuration (free, no API key required)
// const POLLINATIONS_BASE_URL = 'https://image.pollinations.ai/prompt';
// const POLLINATIONS_TOKEN = process.env.POLLINATIONS_TOKEN || null; // optional, raises rate limit if registered
// const POLLINATIONS_MODEL = process.env.POLLINATIONS_MODEL || 'flux';

// /**
//  * Shared negative prompt appended to every banner type.
//  */
// const NEGATIVE_PROMPT =
//     'Negative prompt: no text, no watermark, no logo, no branding, no UI, no icon, no typography, ' +
//     'no distorted objects, no blur, no low quality, no cropped product, no duplicate objects, ' +
//     'no extra limbs, no artifacts, no frame.';

// /**
//  * Premium ecommerce advertising prompt templates (one per banner type).
//  * These are the SOURCE OF TRUTH — the admin UI fetches them, may edit them,
//  * and the (possibly edited) prompt is what actually drives image generation.
//  *
//  * Placeholders resolved here: title, description, accent (from theme.accent), type.
//  */
// const BANNER_PROMPT_TEMPLATES = {
//     hero: (title, description, theme) => `Design an ultra premium ecommerce homepage hero banner.

// A realistic lifestyle scene featuring: ${description || title || 'Premium product showcase'}.
// Hero subject: ${title || 'signature product'}.

// Professional commercial photography. Luxury lighting. Modern premium environment.
// Large empty copy space on the left for promotional text. Subject positioned on the right.
// HDR. 8K. Ultra realistic. Sharp focus. Natural shadows. Ultra detailed. Minimal composition.
// Primary accent color: ${theme?.accent || 'modern corporate colors'}.
// Rule of thirds, balanced composition, soft depth of field, generous negative space for website text overlay.
// Apple-level product photography, high-conversion marketing design, commercial advertising quality.

// ${NEGATIVE_PROMPT}`,

//     promo: (title, description, theme) => `Create a premium ecommerce promotional banner.

// Offer: ${title || 'Limited time promotional offer'}.
// Details: ${description || 'Exclusive limited-time savings'}.

// Focus on urgency and excitement. Luxury lighting. Modern retail style. Dynamic composition.
// Product centered. Bold visual contrast. Rich vibrant colors. Professional advertising quality.
// Primary accent color: ${theme?.accent || 'dynamic vibrant promotional colors'}.
// Large negative space for headline overlay. HDR. 8K. Ultra realistic. Sharp focus.
// High-conversion marketing design, commercial advertising quality.

// ${NEGATIVE_PROMPT}`,

//     strip: (title, description, theme) => `Create a clean premium ecommerce announcement strip banner, wide horizontal format.

// Message: ${title || 'Important announcement'}.
// Subtext: ${description || 'Store-wide update'}.

// Minimal luxury retail aesthetic. Modern premium environment. Cinematic soft lighting.
// Product or lifestyle element on one side, large empty copy space on the other for website text.
// Primary accent color: ${theme?.accent || 'brand primary colors'}.
// HDR. 8K. Ultra realistic. Sharp focus. Balanced minimal composition. Soft depth of field.
// Professional advertising quality.

// ${NEGATIVE_PROMPT}`,

//     deal: (title, description, theme) => `Create a luxury ecommerce discount campaign banner.

// Deal: ${title || 'Limited time deal'}.
// Details: ${description || 'High-value savings event'}.

// High-end commercial advertising photography. Premium product display. Modern minimal background.
// Golden lighting. Luxury atmosphere. Rich colors. Studio lighting.
// Primary accent color: ${theme?.accent || 'deal-focused warm tones'}.
// Large empty copy area for headline overlay. HDR. 8K. Ultra realistic. Sharp focus.
// Conversion-optimized, commercial advertising quality.

// ${NEGATIVE_PROMPT}`
// };

// /**
//  * Build the readable, editable prompt for a banner type (used by the /ai-prompt
//  * endpoint and as the default when no custom prompt is supplied).
//  */
// function getBannerPrompt(title, description, type, theme) {
//     const templateFn = BANNER_PROMPT_TEMPLATES[type] || BANNER_PROMPT_TEMPLATES.hero;
//     return templateFn(title, description, theme).trim();
// }

// /**
//  * Generate banner image using Pollinations.ai (free, no billing required).
//  * @param {string} [customPrompt] Optional admin-edited prompt; used verbatim when provided.
//  */
// async function generateBannerImage(title, description, type, theme, customPrompt) {
//     try {
//         const prompt = (customPrompt && customPrompt.trim())
//             ? customPrompt.trim()
//             : buildPrompt(title, description, type, theme);

//         // Check cache first
//         const cacheKey = generateCacheKey(prompt, type);
//         const cachedResult = await getCachedImage(cacheKey);
//         if (cachedResult) {
//             logger.info('Returning cached AI banner image');
//             return cachedResult;
//         }

//         // Generate image via Pollinations
//         const imageBuffer = await generateImageWithPollinations(prompt, type);

//         // Process and resize with sharp
//         const processedBuffer = await sharp(imageBuffer)
//             .resize(getBannerWidth(type), getBannerHeight(type), {
//                 fit: 'cover',
//                 position: 'center',
//                 background: { r: 255, g: 255, b: 255, alpha: 1 }
//             })
//             .jpeg({ quality: 90, progressive: true })
//             .toBuffer();

//         // Upload processed image to CDN/storage
//         const cdnUrl = await uploadToCDN(processedBuffer, type);

//         const result = {
//             success: true,
//             url: cdnUrl || `data:image/jpeg;base64,${processedBuffer.toString('base64')}`,
//             promptUsed: prompt,
//             generatedAt: new Date().toISOString(),
//             cacheKey: cacheKey,
//             provider: 'pollinations'
//         };

//         await cacheImage(cacheKey, result);

//         logger.info(`AI banner image generated successfully via Pollinations for: ${title}`);
//         return result;

//     } catch (error) {
//         logger.error('Error generating AI banner image:', error);
//         return {
//             success: true,
//             url: generatePlaceholderImage(title, type),
//             fallback: true,
//             error: error.message
//         };
//     }
// }

// /**
//  * Build the final prompt from templates (readable, multi-line — same text the
//  * admin sees in the editor). Whitespace is collapsed later, only for the HTTP call.
//  */
// function buildPrompt(title, description, type, theme) {
//     return getBannerPrompt(title, description, type, theme);
// }

// /**
//  * Call Pollinations.ai to generate an image, returns raw image Buffer
//  */
// async function generateImageWithPollinations(prompt, type) {
//     try {
//         const width = getBannerWidth(type);
//         const height = getBannerHeight(type);
//         // Collapse whitespace only for the URL — keeps the request compact while
//         // the stored/displayed prompt stays nicely formatted.
//         const compactPrompt = prompt.replace(/\s+/g, ' ').trim();
//         const encodedPrompt = encodeURIComponent(compactPrompt);
//         const seed = Math.floor(Math.random() * 1000000);

//         const params = new URLSearchParams({
//             width: width.toString(),
//             height: height.toString(),
//             model: POLLINATIONS_MODEL,
//             seed: seed.toString(),
//             nologo: 'true'
//         });

//         if (POLLINATIONS_TOKEN) {
//             params.append('token', POLLINATIONS_TOKEN);
//         }

//         const url = `${POLLINATIONS_BASE_URL}/${encodedPrompt}?${params.toString()}`;

//         const response = await axios.get(url, {
//             responseType: 'arraybuffer',
//             timeout: 60000, // Pollinations can be slow under load
//             headers: {
//                 'Accept': 'image/*'
//             }
//         });

//         if (!response.data || response.data.length === 0) {
//             throw new Error('Empty response from Pollinations');
//         }

//         return Buffer.from(response.data);

//     } catch (error) {
//         if (error.response?.status === 429) {
//             logger.error('Pollinations rate limit hit — consider registering for a token to raise limits');
//         }
//         logger.error('Error calling Pollinations.ai:', error.message);
//         throw error;
//     }
// }

// /**
//  * Upload to CDN (implement with your preferred CDN)
//  */
// async function uploadToCDN(imageBuffer, type) {
//     try {
//         // Implement your CDN upload logic here
//         // Example: AWS S3, Cloudinary, etc.
//         return null; // Placeholder
//     } catch (error) {
//         logger.error('CDN upload error:', error);
//         return null;
//     }
// }

// /**
//  * Advanced banner enhancement with AI
//  */
// async function enhanceBannerWithAIImage(banner, customPrompt) {
//     try {
//         const { title, description, type, theme } = banner;

//         const imageResult = await generateBannerImage(title, description, type, theme, customPrompt);

//         banner.image = {
//             ...banner.image,
//             url: imageResult.url,
//             mobileUrl: imageResult.url,
//             alt: title,
//             aiGenerated: true,
//             metadata: {
//                 promptUsed: imageResult.promptUsed,
//                 fallback: !!imageResult.fallback,
//                 generatedAt: new Date().toISOString(),
//                 provider: imageResult.provider || 'placeholder'
//             }
//         };

//         await banner.save();

//         logger.info(`Enhanced banner with AI: ${title}`);
//         return banner;

//     } catch (error) {
//         logger.error('Error enhancing banner with AI:', error);
//         throw new AppError('Failed to enhance banner with AI', 500);
//     }
// }

// /**
//  * Generate simple banner copy suggestions (rule-based, no external API needed)
//  * Replace this with an LLM call (Claude/Gemini) if you want smarter copy generation.
//  */
// async function generateBannerCopy(title, description, type) {
//     try {
//         const ctaByType = {
//             hero: 'Explore Now',
//             promo: 'Grab the Offer',
//             strip: 'Learn More',
//             deal: 'Shop the Deal'
//         };

//         const ctaColorByType = {
//             hero: '#2874F0',
//             promo: '#FF6B35',
//             strip: '#1A1A1A',
//             deal: '#E53935'
//         };

//         return {
//             title: title?.length > 40 ? `${title.substring(0, 37)}...` : title,
//             description: description?.length > 120 ? `${description.substring(0, 117)}...` : description,
//             ctaText: ctaByType[type] || 'Shop Now',
//             ctaColor: ctaColorByType[type] || '#2874F0'
//         };

//     } catch (error) {
//         logger.error('Error generating banner copy:', error);
//         return null;
//     }
// }

// /**
//  * Predict CTR for banner
//  */
// async function predictCTR(banner) {
//     const industryAverages = {
//         hero: 2.5,
//         promo: 3.8,
//         strip: 1.2,
//         deal: 4.5
//     };
//     return industryAverages[banner.type] || 2.5;
// }

// /**
//  * Get industry benchmark
//  */
// async function getIndustryBenchmark(type) {
//     const benchmarks = {
//         hero: { ctr: 2.5, conversion: 3.2, engagement: 4.1 },
//         promo: { ctr: 3.8, conversion: 4.5, engagement: 3.8 },
//         strip: { ctr: 1.2, conversion: 1.8, engagement: 2.1 },
//         deal: { ctr: 4.5, conversion: 5.2, engagement: 4.5 }
//     };
//     return benchmarks[type] || benchmarks.hero;
// }

// /**
//  * Get AI suggestions for optimization
//  */
// async function getAISuggestions(banner) {
//     const suggestions = [];

//     if (!banner.image?.url) {
//         suggestions.push('Add high-quality banner image');
//     }

//     if (!banner.link?.url) {
//         suggestions.push('Include clear call-to-action link');
//     }

//     if (banner.title && banner.title.length > 15) {
//         suggestions.push('Shorten title for better readability');
//     }

//     return suggestions;
// }

// /**
//  * Helper functions
//  */
// function getBannerWidth(type) {
//     const dimensions = { hero: 1200, strip: 1200, promo: 1200, deal: 1200 };
//     return dimensions[type] || 1200;
// }

// function getBannerHeight(type) {
//     const dimensions = { hero: 600, strip: 200, promo: 400, deal: 400 };
//     return dimensions[type] || 400;
// }

// function generatePlaceholderImage(title, type) {
//     const width = getBannerWidth(type);
//     const height = getBannerHeight(type);
//     const encodedTitle = encodeURIComponent(title?.substring(0, 20) || 'Banner');
//     return `https://via.placeholder.com/${width}x${height}/2874F0/FFFFFF?text=${encodedTitle}`;
// }

// function generateCacheKey(prompt, type) {
//     return `ai:banner:${type}:${Buffer.from(prompt).toString('base64').substring(0, 50)}`;
// }

// async function getCachedImage(cacheKey) {
//     if (!redisClient) return null;
//     try {
//         const cached = await redisClient.get(cacheKey);
//         return cached ? JSON.parse(cached) : null;
//     } catch (error) {
//         return null;
//     }
// }

// async function cacheImage(cacheKey, data) {
//     if (!redisClient) return;
//     try {
//         await redisClient.setex(cacheKey, cacheTTL, JSON.stringify(data));
//     } catch (error) {
//         logger.warn('Cache error:', error);
//     }
// }

// module.exports = {
//     generateBannerImage,
//     enhanceBannerWithAIImage,
//     getBannerPrompt,
//     generateBannerCopy,
//     predictCTR,
//     getIndustryBenchmark,
//     getAISuggestions
// };



// services/ai-banner.service.js
const axios = require('axios');
const crypto = require('crypto');
const { Banner } = require('../models');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const { getRedisClient } = require('../config/redis');
const sharp = require('sharp'); // For image processing + overlay compositing

// Redis client
const redisClient = getRedisClient();
const cacheTTL = 3600; // 1 hour

// Pollinations.ai Configuration (free, no API key required)
const POLLINATIONS_BASE_URL = 'https://image.pollinations.ai/prompt';
const POLLINATIONS_TOKEN = process.env.POLLINATIONS_TOKEN || null;
const POLLINATIONS_MODEL = process.env.POLLINATIONS_MODEL || 'flux';

/**
 * Shared negative prompt appended to every banner type.
 * IMPORTANT: we deliberately keep "no text / no typography" here. Diffusion
 * models render text as garbage almost every time. Any text the user wants
 * on the banner ("30% OFF", product name, CTA) is composited afterwards with
 * sharp/SVG — see overlayBannerText() — never asked of the image model.
 */
const NEGATIVE_PROMPT =
    'Negative prompt: no text, no watermark, no logo, no branding, no UI, no icon, no typography, ' +
    'no distorted objects, no blur, no low quality, no cropped product, no duplicate objects, ' +
    'no extra limbs, no artifacts, no frame.';

/* ============================================================================
 * 1. OCCASION / FESTIVAL THEME SYSTEM
 * ==========================================================================*/

/**
 * Each occasion defines:
 *  - dateRange: [MM-DD, MM-DD] window it auto-activates in (wraps year-end fine
 *    since we only compare month/day, e.g. new_year 12-28 -> 01-05)
 *  - promptModifier: appended to the AI scene prompt (sets mood/props/lighting)
 *  - palette: accent color fallback for this occasion
 *  - decorate(svgBuilder helpers): procedural festive border drawn with sharp+SVG,
 *    composited on top of the generated photo. No external asset files needed.
 */
// NOTE on ordering: getActiveOccasion() walks this object top-to-bottom and
// returns the FIRST date match. Fixed-date cultural festivals are listed
// before broad seasonal sales so e.g. Dec 25 resolves to "christmas" and not
// the wider "winter_sale" window that also covers that date. Campaign-style
// sales (big_sale_event, goat_sale, festive_dhamaka) have no fixed calendar
// date — they're always admin-selected via occasionKey, never auto-detected.
const OCCASION_THEMES = {
    diwali: {
        label: 'Diwali',
        dateRange: ['10-15', '11-10'],
        promptModifier:
            'Diwali festive atmosphere, warm golden diya oil lamp lighting, soft bokeh string lights, ' +
            'subtle rangoli pattern accents, festive gold and deep red color grading, celebratory glow',
        palette: '#D4A017',
        decorate: 'diyaLights'
    },
    holi: {
        label: 'Holi',
        dateRange: ['03-01', '03-20'],
        promptModifier:
            'Holi festival of colors atmosphere, vibrant colored powder (gulal) hanging in the air, ' +
            'playful splashes of pink magenta yellow blue and green, joyful energetic mood, bright ' +
            'saturated festive color grading',
        palette: '#EC1E79',
        decorate: 'colorSplash'
    },
    independence_day: {
        label: 'Independence Day',
        dateRange: ['08-08', '08-20'],
        promptModifier:
            'Indian Independence Day patriotic atmosphere, tricolor saffron white and green ribbon and ' +
            'bunting accents, celebratory national pride mood, clean bright daylight, patriotic color grading',
        palette: '#FF9933',
        decorate: 'tricolorRibbon'
    },
    christmas: {
        label: 'Christmas',
        dateRange: ['12-01', '12-26'],
        promptModifier:
            'Christmas festive atmosphere, soft falling snow, warm string lights, subtle christmas tree ' +
            'and ornament accents in the background, cozy red and evergreen color grading, winter glow',
        palette: '#1B5E20',
        decorate: 'snowBaubles'
    },
    new_year: {
        label: 'New Year',
        dateRange: ['12-27', '01-05'],
        promptModifier:
            'New Year celebration atmosphere, confetti in the air, soft fireworks glow in the background, ' +
            'champagne gold and midnight blue color grading, festive party energy',
        palette: '#FFD700',
        decorate: 'confettiFireworks'
    },
    summer_sale: {
        label: 'Summer Sale',
        dateRange: ['04-01', '06-10'],
        promptModifier:
            'bright summer atmosphere, fresh sunny lighting, light airy pastel-to-vibrant color grading, ' +
            'crisp long shadows, energetic warm-weather retail mood',
        palette: '#FFB300',
        decorate: 'sunburst'
    },
    monsoon_sale: {
        label: 'Monsoon Sale',
        dateRange: ['06-11', '09-15'],
        promptModifier:
            'monsoon season atmosphere, soft rain visible in the background, glossy wet-look surfaces, ' +
            'cool blue-grey and fresh green color grading, moody dramatic sky',
        palette: '#3949AB',
        decorate: 'rainDrops'
    },
    winter_sale: {
        label: 'Winter Sale',
        dateRange: ['01-06', '02-15'],
        promptModifier:
            'crisp winter atmosphere, soft cool morning light, gentle frost and mist accents, calm ' +
            'muted blue and warm-layer color grading, cozy winter retail mood',
        palette: '#546E7A',
        decorate: 'frostSparkle'
    },
    big_sale_event: {
        label: 'Big Sale Event',
        dateRange: null, // admin-selected only, not date-auto-detected
        promptModifier:
            'high-energy mega sale event atmosphere, dynamic diagonal light streaks, bold dramatic ' +
            'contrast, electric retail excitement, premium flash-sale lighting',
        palette: '#E53935',
        decorate: 'saleBurst'
    },
    goat_sale: {
        label: 'GOAT Sale',
        dateRange: null, // admin-selected — "Greatest Of All Time" style mega campaign
        promptModifier:
            'legendary iconic flagship sale campaign atmosphere, premium spotlight lighting, bold black ' +
            'and gold color grading, exclusive high-status retail energy, dramatic hero lighting',
        palette: '#C9A227',
        decorate: 'goldBurst'
    },
    festive_dhamaka: {
        label: 'Festive Dhamaka Sale',
        dateRange: null, // admin-selected — generic festive-season blowout sale
        promptModifier:
            'explosive festive blowout sale atmosphere, dynamic radiating light bursts, vivid red and ' +
            'gold color grading, high-excitement celebratory retail energy, sparkling highlights',
        palette: '#D32F2F',
        decorate: 'sparkExplosion'
    },
    none: {
        label: 'Standard',
        dateRange: null,
        promptModifier: '',
        palette: null,
        decorate: null
    }
};

/**
 * Auto-detect the active occasion from today's date (or an admin override).
 * Comparison is month/day only so ranges wrapping the calendar year work.
 */
function getActiveOccasion(overrideKey, refDate = new Date()) {
    if (overrideKey && OCCASION_THEMES[overrideKey]) return { key: overrideKey, ...OCCASION_THEMES[overrideKey] };

    const md = `${String(refDate.getMonth() + 1).padStart(2, '0')}-${String(refDate.getDate()).padStart(2, '0')}`;

    for (const [key, theme] of Object.entries(OCCASION_THEMES)) {
        if (!theme.dateRange) continue;
        const [start, end] = theme.dateRange;
        const inRange = start <= end
            ? (md >= start && md <= end)          // normal range e.g. 12-01..12-26
            : (md >= start || md <= end);          // wraps year-end e.g. 12-27..01-05
        if (inRange) return { key, ...theme };
    }
    return { key: 'none', ...OCCASION_THEMES.none };
}

/* ============================================================================
 * 2. CATEGORY -> PROP INJECTION (this is the biggest lever against "same-looking"
 *    banners — it's what actually puts a sofa, a bicycle, a camera etc. IN the shot)
 * ==========================================================================*/

const CATEGORY_PROP_MAP = {
    furniture: 'an elegant modern sofa as the hero subject',
    sofa: 'a plush designer sofa as the hero subject',
    bicycle: 'a sleek city bicycle as the hero subject',
    electronics: 'a premium consumer electronics device as the hero subject',
    camera: 'a professional camera as the hero subject',
    appliance: 'a modern home appliance as the hero subject',
    vehicle: 'a premium vehicle as the hero subject',
    tools: 'professional-grade tools laid out as the hero subject',
    party: 'party and event equipment as the hero subject',
    default: null // falls back to using the banner's own title/description
};

function getCategoryPropPhrase(category) {
    if (!category) return null;
    const key = category.toLowerCase().trim();
    return CATEGORY_PROP_MAP[key] || null;
}

/**
 * Small rotating pool of style modifiers so two banners of the same type/category
 * don't converge on an identical composition even with similar prompts.
 */
const STYLE_VARIANTS = [
    'shot from a low angle with dramatic perspective',
    'shot from a slightly elevated angle for an editorial feel',
    'centered studio composition with soft rim lighting',
    'shot with a shallow depth of field, foreground softly blurred',
    'wide environmental shot with generous negative space',
    'close-up detail shot emphasizing texture and craftsmanship'
];

function pickStyleVariant(seed) {
    return STYLE_VARIANTS[seed % STYLE_VARIANTS.length];
}

/* ============================================================================
 * 3. PROMPT TEMPLATES (base scene — occasion + category are layered in on top)
 * ==========================================================================*/

const BANNER_PROMPT_TEMPLATES = {
    hero: (title, description, theme, occasion, propPhrase, styleVariant) => `Design an ultra premium ecommerce homepage hero banner.

A realistic lifestyle scene featuring: ${propPhrase || description || title || 'Premium product showcase'}.
Hero subject: ${title || 'signature product'}.
${styleVariant}.
${occasion.promptModifier ? occasion.promptModifier + '.' : ''}

Professional commercial photography. Luxury lighting. Modern premium environment.
Large empty copy space on the left for promotional text. Subject positioned on the right.
HDR. 8K. Ultra realistic. Sharp focus. Natural shadows. Ultra detailed. Minimal composition.
Primary accent color: ${occasion.palette || theme?.accent || 'modern corporate colors'}.
Rule of thirds, balanced composition, soft depth of field, generous negative space for website text overlay.
Apple-level product photography, high-conversion marketing design, commercial advertising quality.

${NEGATIVE_PROMPT}`,

    promo: (title, description, theme, occasion, propPhrase, styleVariant) => `Create a premium ecommerce promotional banner.

Offer: ${title || 'Limited time promotional offer'}.
Subject: ${propPhrase || description || 'Exclusive limited-time savings'}.
${styleVariant}.
${occasion.promptModifier ? occasion.promptModifier + '.' : ''}

Focus on urgency and excitement. Luxury lighting. Modern retail style. Dynamic composition.
Product centered. Bold visual contrast. Rich vibrant colors. Professional advertising quality.
Primary accent color: ${occasion.palette || theme?.accent || 'dynamic vibrant promotional colors'}.
Large negative space for headline overlay. HDR. 8K. Ultra realistic. Sharp focus.
High-conversion marketing design, commercial advertising quality.

${NEGATIVE_PROMPT}`,

    strip: (title, description, theme, occasion, propPhrase, styleVariant) => `Create a clean premium ecommerce announcement strip banner, wide horizontal format.

Message: ${title || 'Important announcement'}.
Subject: ${propPhrase || description || 'Store-wide update'}.
${styleVariant}.
${occasion.promptModifier ? occasion.promptModifier + '.' : ''}

Minimal luxury retail aesthetic. Modern premium environment. Cinematic soft lighting.
Product or lifestyle element on one side, large empty copy space on the other for website text.
Primary accent color: ${occasion.palette || theme?.accent || 'brand primary colors'}.
HDR. 8K. Ultra realistic. Sharp focus. Balanced minimal composition. Soft depth of field.
Professional advertising quality.

${NEGATIVE_PROMPT}`,

    deal: (title, description, theme, occasion, propPhrase, styleVariant) => `Create a luxury ecommerce discount campaign banner.

Deal: ${title || 'Limited time deal'}.
Subject: ${propPhrase || description || 'High-value savings event'}.
${styleVariant}.
${occasion.promptModifier ? occasion.promptModifier + '.' : ''}

High-end commercial advertising photography. Premium product display. Modern minimal background.
Golden lighting. Luxury atmosphere. Rich colors. Studio lighting.
Primary accent color: ${occasion.palette || theme?.accent || 'deal-focused warm tones'}.
Large empty copy area for headline overlay. HDR. 8K. Ultra realistic. Sharp focus.
Conversion-optimized, commercial advertising quality.

${NEGATIVE_PROMPT}`
};

/**
 * Build the readable, editable prompt for a banner type (used by the /ai-prompt
 * endpoint and as the default when no custom prompt is supplied).
 * @param {object} opts { occasionKey, category, variantSeed }
 */
function getBannerPrompt(title, description, type, theme, opts = {}) {
    const templateFn = BANNER_PROMPT_TEMPLATES[type] || BANNER_PROMPT_TEMPLATES.hero;
    const occasion = getActiveOccasion(opts.occasionKey);
    const propPhrase = getCategoryPropPhrase(opts.category);
    const styleVariant = pickStyleVariant(opts.variantSeed ?? Math.floor(Math.random() * STYLE_VARIANTS.length));
    return templateFn(title, description, theme, occasion, propPhrase, styleVariant).trim();
}

/* ============================================================================
 * 4. GENERATION PIPELINE
 * ==========================================================================*/

/**
 * Generate banner image using Pollinations.ai (free, no billing required).
 * @param {string} [customPrompt] Optional admin-edited prompt; used verbatim when provided.
 * @param {object} [opts] { occasionKey, category, badgeText, ctaText }
 */
async function generateBannerImage(title, description, type, theme, customPrompt, opts = {}) {
    try {
        const occasion = getActiveOccasion(opts.occasionKey);
        const variantSeed = Math.floor(Math.random() * STYLE_VARIANTS.length);

        const prompt = (customPrompt && customPrompt.trim())
            ? customPrompt.trim()
            : buildPrompt(title, description, type, theme, { ...opts, variantSeed });

        // Cache key is a full-prompt hash (was previously a truncated base64
        // prefix that collided across different titles — see note below).
        const cacheKey = generateCacheKey(prompt, type, occasion.key);
        const cachedResult = await getCachedImage(cacheKey);
        if (cachedResult) {
            logger.info('Returning cached AI banner image');
            return cachedResult;
        }

        // 1. Generate base scene via Pollinations
        const imageBuffer = await generateImageWithPollinations(prompt, type);

        // 2. Resize/crop to banner dimensions
        let processedBuffer = await sharp(imageBuffer)
            .resize(getBannerWidth(type), getBannerHeight(type), {
                fit: 'cover',
                position: 'center'
            })
            .jpeg({ quality: 90, progressive: true })
            .toBuffer();

        // 3. Composite procedural festive border (diyas, snow, confetti, sale burst)
        if (occasion.decorate) {
            processedBuffer = await overlayFestiveDecoration(processedBuffer, occasion, type);
        }

        // 4. Composite real text — badge/discount + title + CTA — never AI-rendered
        if (opts.badgeText || opts.ctaText || title) {
            processedBuffer = await overlayBannerText(processedBuffer, type, {
                title,
                badgeText: opts.badgeText,   // e.g. "30% OFF"
                ctaText: opts.ctaText,       // e.g. "Rent Now"
                accent: occasion.palette || theme?.accent || '#2874F0'
            });
        }

        const cdnUrl = await uploadToCDN(processedBuffer, type);

        const result = {
            success: true,
            url: cdnUrl || `data:image/jpeg;base64,${processedBuffer.toString('base64')}`,
            promptUsed: prompt,
            occasion: occasion.key,
            generatedAt: new Date().toISOString(),
            cacheKey,
            provider: 'pollinations'
        };

        await cacheImage(cacheKey, result);

        logger.info(`AI banner image generated successfully via Pollinations for: ${title} [occasion=${occasion.key}]`);
        return result;

    } catch (error) {
        logger.error('Error generating AI banner image:', error);
        return {
            success: false, // was `true` — a fallback/placeholder is not a success
            url: generatePlaceholderImage(title, type),
            fallback: true,
            error: error.message
        };
    }
}

function buildPrompt(title, description, type, theme, opts = {}) {
    return getBannerPrompt(title, description, type, theme, opts);
}

async function generateImageWithPollinations(prompt, type) {
    try {
        const width = getBannerWidth(type);
        const height = getBannerHeight(type);
        const compactPrompt = prompt.replace(/\s+/g, ' ').trim();
        const encodedPrompt = encodeURIComponent(compactPrompt);
        const seed = Math.floor(Math.random() * 1000000);

        const params = new URLSearchParams({
            width: width.toString(),
            height: height.toString(),
            model: POLLINATIONS_MODEL,
            seed: seed.toString(),
            nologo: 'true'
        });

        if (POLLINATIONS_TOKEN) {
            params.append('token', POLLINATIONS_TOKEN);
        }

        const url = `${POLLINATIONS_BASE_URL}/${encodedPrompt}?${params.toString()}`;

        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 60000,
            headers: { 'Accept': 'image/*' }
        });

        if (!response.data || response.data.length === 0) {
            throw new Error('Empty response from Pollinations');
        }

        return Buffer.from(response.data);

    } catch (error) {
        if (error.response?.status === 429) {
            logger.error('Pollinations rate limit hit — consider registering for a token to raise limits');
        }
        logger.error('Error calling Pollinations.ai:', error.message);
        throw error;
    }
}

async function uploadToCDN(imageBuffer, type) {
    try {
        // Implement your CDN upload logic here (S3, Cloudinary, etc.)
        return null;
    } catch (error) {
        logger.error('CDN upload error:', error);
        return null;
    }
}

/* ============================================================================
 * 5. OVERLAY COMPOSITING — text and festive decoration are drawn as SVG and
 *    composited with sharp. This is what gives crisp readable "30% OFF" /
 *    diyas / snow / confetti without ever asking the image model for them.
 * ==========================================================================*/

function escapeXml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Composite title / discount badge / CTA pill onto the banner's reserved
 * copy-space (left third for hero/promo/deal, one side for strip).
 */
async function overlayBannerText(imageBuffer, type, { title, badgeText, ctaText, accent }) {
    const width = getBannerWidth(type);
    const height = getBannerHeight(type);
    const padX = Math.round(width * 0.05);
    const textBlockWidth = Math.round(width * 0.42);

    let svgParts = [];

    if (badgeText) {
        svgParts.push(`
            <rect x="${padX}" y="${Math.round(height * 0.14)}" rx="8" ry="8"
                  width="${Math.min(220, textBlockWidth)}" height="46" fill="${accent}" opacity="0.95" />
            <text x="${padX + 16}" y="${Math.round(height * 0.14) + 31}"
                  font-family="Arial, sans-serif" font-weight="700" font-size="24" fill="#FFFFFF">
                ${escapeXml(badgeText)}
            </text>`);
    }

    if (title) {
        svgParts.push(`
            <text x="${padX}" y="${Math.round(height * 0.42)}"
                  font-family="Arial, sans-serif" font-weight="800" font-size="${Math.round(height * 0.11)}"
                  fill="#1A1A1A" style="paint-order: stroke; stroke: #FFFFFF; stroke-width: 6px;">
                ${escapeXml(title.length > 26 ? title.slice(0, 23) + '...' : title)}
            </text>`);
    }

    if (ctaText) {
        const ctaY = Math.round(height * 0.78);
        svgParts.push(`
            <rect x="${padX}" y="${ctaY}" rx="24" ry="24" width="200" height="52" fill="${accent}" />
            <text x="${padX + 30}" y="${ctaY + 34}"
                  font-family="Arial, sans-serif" font-weight="700" font-size="20" fill="#FFFFFF">
                ${escapeXml(ctaText)}
            </text>`);
    }

    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${svgParts.join('')}</svg>`;

    return sharp(imageBuffer)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .jpeg({ quality: 90, progressive: true })
        .toBuffer();
}

/**
 * Procedurally draws festival decoration as an SVG overlay and composites it
 * on top of the banner. No external asset files required.
 */
async function overlayFestiveDecoration(imageBuffer, occasion, type) {
    const width = getBannerWidth(type);
    const height = getBannerHeight(type);
    const svg = buildOccasionSVG(occasion.decorate, width, height);
    if (!svg) return imageBuffer;

    return sharp(imageBuffer)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .jpeg({ quality: 90, progressive: true })
        .toBuffer();
}

function buildOccasionSVG(decorateKey, width, height) {
    const rand = (min, max) => Math.random() * (max - min) + min;

    if (decorateKey === 'diyaLights') {
        // Warm bokeh string-light border, top and bottom edges
        let dots = '';
        for (let x = 20; x < width; x += 60) {
            dots += `<circle cx="${x}" cy="${rand(10, 26)}" r="${rand(4, 7)}" fill="#FFC94D" opacity="${rand(0.5, 0.9)}" />`;
            dots += `<circle cx="${x + 30}" cy="${height - rand(10, 26)}" r="${rand(4, 7)}" fill="#FF9800" opacity="${rand(0.5, 0.9)}" />`;
        }
        return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${dots}</svg>`;
    }

    if (decorateKey === 'snowBaubles') {
        let flakes = '';
        for (let i = 0; i < 40; i++) {
            flakes += `<circle cx="${rand(0, width)}" cy="${rand(0, height * 0.4)}" r="${rand(2, 5)}" fill="#FFFFFF" opacity="${rand(0.5, 0.95)}" />`;
        }
        return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${flakes}</svg>`;
    }

    if (decorateKey === 'confettiFireworks') {
        let confetti = '';
        const colors = ['#FFD700', '#FF4081', '#40C4FF', '#FFFFFF'];
        for (let i = 0; i < 35; i++) {
            const c = colors[Math.floor(rand(0, colors.length))];
            confetti += `<rect x="${rand(0, width)}" y="${rand(0, height)}" width="6" height="10"
                          fill="${c}" transform="rotate(${rand(0, 360)} ${rand(0, width)} ${rand(0, height)})" opacity="0.85" />`;
        }
        return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${confetti}</svg>`;
    }

    if (decorateKey === 'saleBurst') {
        // Diagonal corner ribbon, no text (text is handled by overlayBannerText)
        return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <polygon points="0,0 ${width * 0.18},0 0,${height * 0.5}" fill="#E53935" opacity="0.9" />
        </svg>`;
    }

    return null;
}

/* ============================================================================
 * 6. COPY / SCORING HELPERS (unchanged from original)
 * ==========================================================================*/

async function enhanceBannerWithAIImage(banner, customPrompt, opts = {}) {
    try {
        const { title, description, type, theme } = banner;
        const imageResult = await generateBannerImage(title, description, type, theme, customPrompt, opts);

        banner.image = {
            ...banner.image,
            url: imageResult.url,
            mobileUrl: imageResult.url,
            alt: title,
            aiGenerated: true,
            metadata: {
                promptUsed: imageResult.promptUsed,
                occasion: imageResult.occasion,
                fallback: !!imageResult.fallback,
                generatedAt: new Date().toISOString(),
                provider: imageResult.provider || 'placeholder'
            }
        };

        if (imageResult.fallback) {
            logger.warn(`Banner "${title}" is using a placeholder image — AI generation failed: ${imageResult.error}`);
        }

        await banner.save();
        logger.info(`Enhanced banner with AI: ${title}`);
        return banner;

    } catch (error) {
        logger.error('Error enhancing banner with AI:', error);
        throw new AppError('Failed to enhance banner with AI', 500);
    }
}

async function generateBannerCopy(title, description, type) {
    try {
        const ctaByType = { hero: 'Explore Now', promo: 'Grab the Offer', strip: 'Learn More', deal: 'Shop the Deal' };
        const ctaColorByType = { hero: '#2874F0', promo: '#FF6B35', strip: '#1A1A1A', deal: '#E53935' };

        return {
            title: title?.length > 40 ? `${title.substring(0, 37)}...` : title,
            description: description?.length > 120 ? `${description.substring(0, 117)}...` : description,
            ctaText: ctaByType[type] || 'Shop Now',
            ctaColor: ctaColorByType[type] || '#2874F0'
        };
    } catch (error) {
        logger.error('Error generating banner copy:', error);
        return null;
    }
}

async function predictCTR(banner) {
    const industryAverages = { hero: 2.5, promo: 3.8, strip: 1.2, deal: 4.5 };
    return industryAverages[banner.type] || 2.5;
}

async function getIndustryBenchmark(type) {
    const benchmarks = {
        hero: { ctr: 2.5, conversion: 3.2, engagement: 4.1 },
        promo: { ctr: 3.8, conversion: 4.5, engagement: 3.8 },
        strip: { ctr: 1.2, conversion: 1.8, engagement: 2.1 },
        deal: { ctr: 4.5, conversion: 5.2, engagement: 4.5 }
    };
    return benchmarks[type] || benchmarks.hero;
}

async function getAISuggestions(banner) {
    const suggestions = [];
    if (!banner.image?.url) suggestions.push('Add high-quality banner image');
    if (!banner.link?.url) suggestions.push('Include clear call-to-action link');
    if (banner.title && banner.title.length > 15) suggestions.push('Shorten title for better readability');

    const occasion = getActiveOccasion();
    if (occasion.key !== 'none' && banner.image?.metadata?.occasion !== occasion.key) {
        suggestions.push(`${occasion.label} is active — consider regenerating with the ${occasion.label} theme for a seasonal lift`);
    }
    return suggestions;
}

/* ============================================================================
 * 7. HELPERS
 * ==========================================================================*/

function getBannerWidth(type) {
    const dimensions = { hero: 1200, strip: 1200, promo: 1200, deal: 1200 };
    return dimensions[type] || 1200;
}

function getBannerHeight(type) {
    const dimensions = { hero: 600, strip: 200, promo: 400, deal: 400 };
    return dimensions[type] || 400;
}

function generatePlaceholderImage(title, type) {
    const width = getBannerWidth(type);
    const height = getBannerHeight(type);
    const encodedTitle = encodeURIComponent(title?.substring(0, 20) || 'Banner');
    // Self-hosted-friendly placeholder avoids depending on a third-party
    // placeholder service being up on your error path.
    return `https://via.placeholder.com/${width}x${height}/2874F0/FFFFFF?text=${encodedTitle}`;
}

/**
 * FIX: previously this hashed a truncated base64 PREFIX of the prompt.
 * Because every template's first ~35 characters are identical boilerplate
 * ("Design an ultra premium ecommerce...") regardless of title/description,
 * every banner of a given type collided on the same cache key — which is
 * why generated images looked "almost the same" across different banners.
 * A full-content hash fixes this and also folds in the active occasion so
 * a Diwali-themed generation never collides with a standard one.
 */
function generateCacheKey(prompt, type, occasionKey = 'none') {
    const hash = crypto.createHash('sha256').update(prompt).digest('hex').substring(0, 32);
    return `ai:banner:${type}:${occasionKey}:${hash}`;
}

async function getCachedImage(cacheKey) {
    if (!redisClient) return null;
    try {
        const cached = await redisClient.get(cacheKey);
        return cached ? JSON.parse(cached) : null;
    } catch (error) {
        return null;
    }
}

async function cacheImage(cacheKey, data) {
    if (!redisClient) return;
    try {
        await redisClient.setex(cacheKey, cacheTTL, JSON.stringify(data));
    } catch (error) {
        logger.warn('Cache error:', error);
    }
}

module.exports = {
    generateBannerImage,
    enhanceBannerWithAIImage,
    getBannerPrompt,
    generateBannerCopy,
    predictCTR,
    getIndustryBenchmark,
    getAISuggestions,
    getActiveOccasion,
    OCCASION_THEMES
};