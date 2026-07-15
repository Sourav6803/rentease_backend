
// const axios = require("axios");
// const sharp = require("sharp");
// const mongoose = require("mongoose");
// const logger = require("../config/logger");
// const { Category, Product, Rental } = require("../models");
// const { getRedisClient } = require("../config/redis");

// // Redis client
// const redisClient = getRedisClient();
// const cacheTTL = 3600; // 1 hour

// // Mistral API configuration
// const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "fVEJCEjH8ibujRVoxYQS5uqhFj86gipT";
// const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

// /**
//  * Generate content using Mistral AI
//  */
// async function generateWithMistral(prompt) {
//   if (!MISTRAL_API_KEY) {
//     throw new Error('Mistral API key not configured');
//   }

//   try {
//     const response = await axios.post(
//       MISTRAL_API_URL,
//       {
//         model: "mistral-small-latest",
//         messages: [
//           { 
//             role: "system", 
//             content: "You are an expert e-commerce category structure designer for a rental platform. Return ONLY valid JSON. Do not include any markdown, explanations, or extra text. Just pure JSON." 
//           },
//           { role: "user", content: prompt }
//         ],
//         temperature: 0.3, // Lower temperature for more consistent JSON
//         max_tokens: 4096,
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${MISTRAL_API_KEY}`,
//           "Content-Type": "application/json",
//         },
//         timeout: 60000,
//       }
//     );

//     return response.data.choices[0].message.content;
//   } catch (error) {
//     logger.error('Mistral AI error:', error.response?.data || error.message);
//     throw error;
//   }
// }

// /**
//  * Enhanced JSON extraction with multiple strategies
//  */
// function extractJSONFromResponse(text) {
//   console.log("🔍 Attempting to extract JSON from response...");
  
//   // Strategy 1: Remove markdown code blocks
//   let cleaned = text.replace(/```json\s*/g, "");
//   cleaned = cleaned.replace(/```\s*/g, "");
  
//   // Strategy 2: Find JSON object using regex
//   let jsonMatch = cleaned.match(/\{[\s\S]*\}/);
//   if (!jsonMatch) {
//     console.warn("No JSON object found");
//     return null;
//   }
  
//   let jsonString = jsonMatch[0];
  
//   // Strategy 3: Try to parse directly
//   try {
//     JSON.parse(jsonString);
//     console.log("✅ Direct JSON parse successful");
//     return jsonString;
//   } catch (e) {
//     console.log("Direct parse failed, trying repairs...");
//   }
  
//   // Strategy 4: Fix common JSON issues
//   jsonString = fixCommonJSONErrors(jsonString);
//   try {
//     JSON.parse(jsonString);
//     console.log("✅ Fixed JSON parse successful");
//     return jsonString;
//   } catch (e) {
//     console.log("Fixed parse failed, trying advanced repairs...");
//   }
  
//   // Strategy 5: Advanced repairs
//   jsonString = advancedJSONRepair(jsonString);
//   try {
//     JSON.parse(jsonString);
//     console.log("✅ Advanced repair successful");
//     return jsonString;
//   } catch (e) {
//     console.log("Advanced repair failed");
//   }
  
//   // Strategy 6: Try to extract partial JSON
//   const partialJson = extractPartialJSON(jsonString);
//   if (partialJson) {
//     try {
//       JSON.parse(partialJson);
//       console.log("✅ Partial JSON extraction successful");
//       return partialJson;
//     } catch (e) {}
//   }
  
//   console.error("❌ All JSON extraction strategies failed");
//   return null;
// }

// /**
//  * Advanced JSON repair for common issues
//  */
// function advancedJSONRepair(jsonString) {
//   let repaired = jsonString;
  
//   // Fix trailing commas in objects and arrays
//   repaired = repaired.replace(/,\s*}/g, "}");
//   repaired = repaired.replace(/,\s*\]/g, "]");
  
//   // Fix missing quotes around property names
//   repaired = repaired.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
  
//   // Fix single quotes to double quotes
//   repaired = repaired.replace(/'/g, '"');
  
//   // Fix missing quotes around string values
//   repaired = repaired.replace(/:\s*([a-zA-Z][a-zA-Z0-9_]*)(?=[,}\]])/g, ':"$1"');
  
//   // Fix unescaped quotes inside strings
//   repaired = repaired.replace(/(?<!\\)"(?![,}\]])/g, '\\"');
  
//   // Fix missing closing braces/brackets
//   let openBraces = (repaired.match(/{/g) || []).length;
//   let closeBraces = (repaired.match(/}/g) || []).length;
//   let openBrackets = (repaired.match(/\[/g) || []).length;
//   let closeBrackets = (repaired.match(/\]/g) || []).length;
  
//   if (openBraces > closeBraces) {
//     repaired += "}".repeat(openBraces - closeBraces);
//   }
//   if (openBrackets > closeBrackets) {
//     repaired += "]".repeat(openBrackets - closeBrackets);
//   }
  
//   // Remove trailing commas at the end
//   repaired = repaired.replace(/,\s*$/, "");
  
//   return repaired;
// }

// /**
//  * Extract partial JSON (best effort)
//  */
// function extractPartialJSON(jsonString) {
//   // Try to find the last complete object
//   let braceCount = 0;
//   let lastValidIndex = -1;
  
//   for (let i = 0; i < jsonString.length; i++) {
//     if (jsonString[i] === '{') braceCount++;
//     if (jsonString[i] === '}') braceCount--;
    
//     if (braceCount === 0 && i > 0) {
//       lastValidIndex = i;
//     }
//   }
  
//   if (lastValidIndex > 0) {
//     return jsonString.substring(0, lastValidIndex + 1);
//   }
  
//   return null;
// }

// /**
//  * Fix common JSON errors
//  */
// function fixCommonJSONErrors(jsonString) {
//   // Fix trailing commas
//   jsonString = jsonString.replace(/,\s*}/g, "}");
//   jsonString = jsonString.replace(/,\s*\]/g, "]");
  
//   // Fix unquoted property names
//   jsonString = jsonString.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
  
//   // Fix single quotes
//   jsonString = jsonString.replace(/'/g, '"');
  
//   // Fix missing quotes around values
//   jsonString = jsonString.replace(/:\s*([a-zA-Z][a-zA-Z0-9_]*)(?=[,}\]])/g, ':"$1"');
  
//   return jsonString;
// }

// /**
//  * Build prompt for category generation - Simplified and more structured
//  */
// // function buildCategoryPrompt(categoryName, parentCategory) {
// //   return `Create a category structure for "${categoryName}"${parentCategory ? ` under parent category "${parentCategory}"` : ""} for a rental platform.

// // IMPORTANT: Return ONLY valid JSON. No markdown, no explanations, no extra text.

// // Use this exact structure with realistic data:

// // {
// //   "mainCategory": {
// //     "name": "${categoryName}",
// //     "description": "A brief description of what this category offers for rent",
// //     "keywords": ["keyword1", "keyword2", "keyword3"],
// //     "iconSuggestion": "📦",
// //     "colorScheme": "#3B82F6",
// //     "popularity": 7
// //   },
// //   "subCategories": [
// //     {
// //       "name": "Premium ${categoryName}",
// //       "description": "High-end ${categoryName} products",
// //       "attributes": [
// //         {"name": "Brand", "type": "select", "required": true, "filterable": true, "options": ["Brand A", "Brand B", "Brand C"]},
// //         {"name": "Condition", "type": "select", "required": true, "filterable": true, "options": ["New", "Like New", "Good"]}
// //       ],
// //       "typicalProducts": ["Product 1", "Product 2"],
// //       "estimatedDemand": "high",
// //       "rentalPriceRange": {"min": 500, "max": 5000},
// //       "popularBrands": ["Brand X", "Brand Y"]
// //     }
// //   ],
// //   "suggestedAttributes": [
// //     {"name": "Brand", "type": "select", "applicableTo": ["all"], "options": ["Brand A", "Brand B"]},
// //     {"name": "Condition", "type": "select", "applicableTo": ["all"], "options": ["New", "Like New", "Good"]}
// //   ],
// //   "industryStandards": {
// //     "specifications": ["Quality assured", "Certified product"],
// //     "warrantyTerms": ["1 year warranty"],
// //     "maintenanceRequirements": ["Regular cleaning"]
// //   }
// // }`;
// // }

// function buildCategoryPrompt(categoryName, parentCategory = null, level = 0) {
//   const isLeafLevel = level >= 3; // Level 3 or 4 is leaf level
  
//   let prompt = `Create a category structure for "${categoryName}"${parentCategory ? ` under parent category "${parentCategory}"` : ""} for a rental platform.

// IMPORTANT: Return ONLY valid JSON. No markdown, no explanations, no extra text.

// CRITICAL RULES:
// - Attributes should ONLY be added at the LEAF level (deepest subcategories)
// - Parent categories should NOT have attributes
// - Maximum depth: 4 levels
// - Level 0: Main category (no attributes)
// - Level 1: Sub-category (no attributes)  
// - Level 2: Sub-sub-category (no attributes)
// - Level 3/4: Leaf category (has attributes, no further children)

// Use this exact structure:

// {
//   "mainCategory": {
//     "name": "${categoryName}",
//     "description": "Brief description",
//     "iconSuggestion": "📦",
//     "colorScheme": "#3B82F6"
//   },
//   "subCategories": [
//     {
//       "name": "Category Name",
//       "description": "Brief description",
//       "hasChildren": true,  // Set to false for leaf categories
//       "children": [  // Only if hasChildren is true
//         {
//           "name": "Leaf Category Name",
//           "description": "Description",
//           "hasChildren": false,
//           "attributes": [  // ONLY at leaf level (hasChildren: false)
//             {
//               "name": "Brand",
//               "type": "select",
//               "required": true,
//               "filterable": true,
//               "options": ["Brand A", "Brand B", "Brand C"]
//             },
//             {
//               "name": "Condition",
//               "type": "select", 
//               "required": true,
//               "filterable": true,
//               "options": ["New", "Like New", "Good", "Fair"]
//             },
//             {
//               "name": "Material",
//               "type": "select",
//               "required": false,
//               "filterable": true,
//               "options": ["Wood", "Metal", "Fabric", "Plastic"]
//             }
//           ],
//           "typicalProducts": ["Product 1", "Product 2"]
//         }
//       ]
//     }
//   ]
// }`;

//   if (!isLeafLevel) {
//     prompt += `\n\nREMINDER: This is NOT a leaf level (level ${level}). Do NOT add attributes to categories at this level.`;
//   }

//   return prompt;
// }

// /**
//  * Parse AI response with enhanced error handling
//  */
// function parseAICategoryResponse(response, categoryName) {
//   try {
//     console.log("📝 Parsing AI response...");
    
//     // Try to extract and clean JSON
//     const cleanedJson = extractJSONFromResponse(response);
    
//     if (!cleanedJson) {
//       console.warn("⚠️ Could not extract valid JSON, using fallback");
//       return getFallbackCategoryData(categoryName);
//     }
    
//     let parsed;
//     try {
//       parsed = JSON.parse(cleanedJson);
//       console.log("✅ JSON parsed successfully");
//     } catch (e) {
//       console.error("JSON parse error:", e.message);
//       return getFallbackCategoryData(categoryName);
//     }
    
//     if (!parsed.mainCategory) {
//       console.warn("Missing mainCategory in response");
//       return getFallbackCategoryData(categoryName);
//     }
    
//     // Build validated data
//     const validatedData = {
//       mainCategory: {
//         name: parsed.mainCategory.name || categoryName,
//         description: parsed.mainCategory.description || `Products related to ${categoryName}`,
//         keywords: Array.isArray(parsed.mainCategory.keywords) ? parsed.mainCategory.keywords : [categoryName.toLowerCase()],
//         iconSuggestion: parsed.mainCategory.iconSuggestion || getDefaultIcon(categoryName),
//         colorScheme: parsed.mainCategory.colorScheme || "#3B82F6",
//         popularity: typeof parsed.mainCategory.popularity === "number" ? parsed.mainCategory.popularity : 5,
//       },
//       subCategories: Array.isArray(parsed.subCategories) && parsed.subCategories.length > 0
//         ? parsed.subCategories.map((sub) => ({
//             name: sub.name || `${categoryName} Item`,
//             description: sub.description || "",
//             attributes: Array.isArray(sub.attributes)
//               ? sub.attributes.map((attr) => ({
//                   name: attr.name || "Attribute",
//                   type: attr.type || "text",
//                   required: attr.required || false,
//                   filterable: attr.filterable || false,
//                   options: Array.isArray(attr.options) ? attr.options : [],
//                   unit: attr.unit || "",
//                 }))
//               : [],
//             typicalProducts: Array.isArray(sub.typicalProducts) ? sub.typicalProducts : [],
//             estimatedDemand: ["high", "medium", "low"].includes(sub.estimatedDemand) ? sub.estimatedDemand : "medium",
//             rentalPriceRange: {
//               min: sub.rentalPriceRange?.min || 100,
//               max: sub.rentalPriceRange?.max || 5000,
//             },
//             popularBrands: Array.isArray(sub.popularBrands) ? sub.popularBrands : [],
//           }))
//         : getDefaultSubcategories(categoryName),
//       suggestedAttributes: Array.isArray(parsed.suggestedAttributes) ? parsed.suggestedAttributes : getDefaultAttributes(),
//       industryStandards: {
//         specifications: Array.isArray(parsed.industryStandards?.specifications) ? parsed.industryStandards.specifications : ["Quality assured"],
//         warrantyTerms: Array.isArray(parsed.industryStandards?.warrantyTerms) ? parsed.industryStandards.warrantyTerms : ["1 year warranty"],
//         maintenanceRequirements: Array.isArray(parsed.industryStandards?.maintenanceRequirements) ? parsed.industryStandards.maintenanceRequirements : ["Regular cleaning"],
//       },
//       generatedAt: new Date().toISOString(),
//     };
    
//     console.log("✅ Successfully validated AI response");
//     return { success: true, data: validatedData };
//   } catch (error) {
//     console.error("❌ Error parsing AI response:", error.message);
//     return getFallbackCategoryData(categoryName);
//   }
// }

// /**
//  * Get default attributes
//  */
// function getDefaultAttributes() {
//   return [
//     { name: "Brand", type: "select", applicableTo: ["all"], options: ["Brand A", "Brand B", "Brand C"] },
//     { name: "Condition", type: "select", applicableTo: ["all"], options: ["New", "Like New", "Good", "Fair"] },
//     { name: "Price Range", type: "number", applicableTo: ["all"], unit: "₹" }
//   ];
// }

// /**
//  * Get default subcategories
//  */
// function getDefaultSubcategories(categoryName) {
//   return [
//     {
//       name: `Premium ${categoryName}`,
//       description: `High-end ${categoryName} products`,
//       attributes: [
//         { name: "Brand", type: "select", required: true, filterable: true, options: ["Premium Brand A", "Premium Brand B"] },
//         { name: "Condition", type: "select", required: true, filterable: true, options: ["New", "Like New", "Excellent"] }
//       ],
//       typicalProducts: [`Premium ${categoryName} Item 1`, `Premium ${categoryName} Item 2`],
//       estimatedDemand: "medium",
//       rentalPriceRange: { min: 1000, max: 10000 },
//       popularBrands: ["Premium Brand A", "Premium Brand B"],
//     },
//     {
//       name: `Standard ${categoryName}`,
//       description: `Affordable ${categoryName} products`,
//       attributes: [
//         { name: "Brand", type: "select", required: true, filterable: true, options: ["Brand X", "Brand Y"] },
//         { name: "Condition", type: "select", required: true, filterable: true, options: ["Good", "Fair"] }
//       ],
//       typicalProducts: [`Standard ${categoryName} Item`],
//       estimatedDemand: "high",
//       rentalPriceRange: { min: 500, max: 3000 },
//       popularBrands: ["Brand X", "Brand Y"],
//     },
//   ];
// }

// /**
//  * Get default icon for category
//  */
// function getDefaultIcon(categoryName) {
//   const iconMap = {
//     bed: "🛏️",
//     mattress: "🛏️",
//     furniture: "🛋️",
//     sofa: "🛋️",
//     table: "🪑",
//     chair: "🪑",
//     electronics: "📱",
//     mobile: "📱",
//     phone: "📱",
//     appliances: "🔌",
//     refrigerator: "🧊",
//     "washing machine": "🧺",
//     ac: "❄️",
//     clothing: "👕",
//     books: "📚",
//     sports: "⚽",
//     toys: "🧸",
//   };
  
//   const lowerName = categoryName.toLowerCase();
//   for (const [key, icon] of Object.entries(iconMap)) {
//     if (lowerName.includes(key)) {
//       return icon;
//     }
//   }
//   return "📦";
// }

// /**````````````````````
//  * Get fallback category data
//  */
// function getFallbackCategoryData(categoryName) {
//   console.log(`📦 Using fallback data for category: ${categoryName}`);
//   return {
//     success: true,
//     data: {
//       mainCategory: {
//         name: categoryName,
//         description: `Quality ${categoryName} available for rent on flexible terms. Choose from our wide range of options.`,
//         keywords: [categoryName.toLowerCase(), "rental", "premium", "quality"],
//         iconSuggestion: getDefaultIcon(categoryName),
//         colorScheme: "#3B82F6",
//         popularity: 5,
//       },
//       subCategories: getDefaultSubcategories(categoryName),
//       suggestedAttributes: getDefaultAttributes(),
//       industryStandards: {
//         specifications: ["Quality assured", "Certified product", "Safe for use"],
//         warrantyTerms: ["1 year standard warranty", "Extended warranty available"],
//         maintenanceRequirements: ["Regular cleaning", "Periodic inspection"],
//       },
//       generatedAt: new Date().toISOString(),
//     },
//   };
// }

// /**
//  * Generate category suggestions using Mistral AI
//  */
// async function generateCategorySuggestions(categoryName, parentCategory = null, level = 0) {
//   try {
//     const cacheKey = `ai:category:suggestions:${categoryName}:${parentCategory || "root"}`;

//     // Check cache
//     if (redisClient) {
//       const cached = await redisClient.get(cacheKey);
//       if (cached) {
//         console.log("📦 Returning cached result");
//         return JSON.parse(cached);
//       }
//     }

//     const prompt = buildCategoryPrompt(categoryName, parentCategory, level);
//     console.log(`📤 Generating category for: ${categoryName} using Mistral AI`);

//     let text;
//     try {
//       text = await generateWithMistral(prompt);
//       console.log(`📥 Response length: ${text.length} chars`);
//     } catch (error) {
//       console.error("Mistral AI request failed:", error.message);
//       return getFallbackCategoryData(categoryName);
//     }

//     const suggestions = parseAICategoryResponse(text, categoryName);

//     if (redisClient && suggestions.success) {
//       await redisClient.setex(cacheKey, cacheTTL, JSON.stringify(suggestions));
//     }

//     return suggestions;
//   } catch (error) {
//     logger.error("Error generating category suggestions:", error.message);
//     return getFallbackCategoryData(categoryName);
//   }
// }

// /**
//  * Generate category icon (simplified)
//  */
// async function generateCategoryIcon(categoryName, description = "") {
//   // Return default icon data (simplified)
//   const icon = getDefaultIcon(categoryName);
//   return {
//     success: true,
//     url: `https://via.placeholder.com/100x100?text=${encodeURIComponent(icon)}`,
//     thumbnail: `https://via.placeholder.com/100x100?text=${encodeURIComponent(icon)}`,
//     metadata: { category: categoryName, generatedBy: "Fallback", timestamp: new Date().toISOString() },
//   };
// }

// /**
//  * Generate icon variations
//  */
// async function generateIconVariations(categoryName, description = "", count = 4) {
//   const icon = getDefaultIcon(categoryName);
//   const variations = [];
//   for (let i = 0; i < count; i++) {
//     variations.push({
//       success: true,
//       url: `https://via.placeholder.com/100x100?text=${encodeURIComponent(icon)}`,
//       thumbnail: `https://via.placeholder.com/100x100?text=${encodeURIComponent(icon)}`,
//     });
//   }
//   return { success: true, variations, count: variations.length };
// }

// /**
//  * Save AI-generated category to database
//  */
// async function saveCategoryFromAI(categoryData, userId) {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const { mainCategory, subCategories, suggestedAttributes } = categoryData;
//     if (!mainCategory?.name) throw new Error("Category name is required");

//     let slug = mainCategory.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
//     let existingCategory = await Category.findOne({ slug }).session(session);
//     let counter = 1;
//     while (existingCategory) {
//       slug = `${mainCategory.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${counter}`;
//       existingCategory = await Category.findOne({ slug }).session(session);
//       counter++;
//     }

//     let imageData = null;
//     if (mainCategory.iconUrl) {
//       imageData = { url: mainCategory.iconUrl, thumbnail: mainCategory.iconUrl.replace("/upload/", "/upload/w_100,h_100,c_fill/") };
//     }

//     const category = await Category.create([{
//       name: mainCategory.name,
//       description: mainCategory.description || `Products related to ${mainCategory.name}`,
//       slug: slug,
//       parent: null,
//       icon: mainCategory.iconSuggestion || "📦",
//       image: imageData,
//       meta: {
//         title: mainCategory.name,
//         description: mainCategory.description || `Rent ${mainCategory.name} on RentEase`,
//         keywords: mainCategory.keywords || [mainCategory.name.toLowerCase()],
//       },
//       attributes: suggestedAttributes || [],
//       isActive: true,
//       displayOrder: 0,
//       level: 0,
//       ancestors: [],
//       metadata: { createdBy: userId, aiGenerated: true, generatedAt: new Date() },
//     }], { session });

//     if (subCategories && subCategories.length > 0) {
//       for (const subCat of subCategories) {
//         if (subCat.name) {
//           const subSlug = `${slug}-${subCat.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
//           await Category.create([{
//             name: subCat.name,
//             description: subCat.description || "",
//             slug: subSlug,
//             parent: category[0]._id,
//             icon: subCat.iconSuggestion || "📄",
//             attributes: subCat.attributes || suggestedAttributes || [],
//             isActive: true,
//             metadata: { createdBy: userId, aiGenerated: true, parentSuggestion: true },
//           }], { session });
//         }
//       }
//     }

//     await session.commitTransaction();
//     return category[0];
//   } catch (error) {
//     await session.abortTransaction();
//     logger.error("Error saving AI-generated category:", error);
//     throw error;
//   } finally {
//     session.endSession();
//   }
// }

// // Export all functions
// module.exports = {
//   generateCategorySuggestions,
//   generateCategoryIcon,
//   generateIconVariations,
//   saveCategoryFromAI,
//   getDefaultIcon,
//   getFallbackCategoryData,
// };


// services/ai-category.service.js
const axios = require("axios");
const mongoose = require("mongoose");
const logger = require("../config/logger");
const { Category } = require("../models");
const { getRedisClient } = require("../config/redis");

// Redis client
const redisClient = getRedisClient();
const cacheTTL = 3600; // 1 hour

// Mistral API configuration
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

/**
 * Generate content using Mistral AI
 */
async function generateWithMistral(prompt) {
  if (!MISTRAL_API_KEY) {
    throw new Error('Mistral API key not configured');
  }

  try {
    const response = await axios.post(
      MISTRAL_API_URL,
      {
        model: "mistral-small-latest",
        messages: [
          { 
            role: "system", 
            content: "You are an expert e-commerce category structure designer for a rental platform. Return ONLY valid JSON. No markdown, no explanations, no extra text." 
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 4096,
      },
      {
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    logger.error('Mistral AI error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Enhanced JSON extraction with multiple strategies
 */
function extractJSONFromResponse(text) {
  console.log("🔍 Attempting to extract JSON from response...");
  
  // Remove markdown code blocks
  let cleaned = text.replace(/```json\s*/g, "");
  cleaned = cleaned.replace(/```\s*/g, "");
  
  // Find JSON object
  let jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("No JSON object found");
    return null;
  }
  
  let jsonString = jsonMatch[0];
  
  // Try direct parse
  try {
    JSON.parse(jsonString);
    console.log("✅ Direct JSON parse successful");
    return jsonString;
  } catch (e) {
    console.log("Direct parse failed, trying repairs...");
  }
  
  // Fix common JSON issues
  jsonString = fixCommonJSONErrors(jsonString);
  try {
    JSON.parse(jsonString);
    console.log("✅ Fixed JSON parse successful");
    return jsonString;
  } catch (e) {
    console.log("Fixed parse failed");
  }
  
  console.error("❌ All JSON extraction strategies failed");
  return null;
}

/**
 * Fix common JSON errors
 */
function fixCommonJSONErrors(jsonString) {
  let fixed = jsonString;
  
  // Fix trailing commas
  fixed = fixed.replace(/,\s*}/g, "}");
  fixed = fixed.replace(/,\s*\]/g, "]");
  
  // Fix unquoted property names
  fixed = fixed.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
  
  // Fix single quotes
  fixed = fixed.replace(/'/g, '"');
  
  return fixed;
}

/**
 * Build prompt for category generation - Only add attributes at leaf level
 */
// function buildCategoryPrompt(categoryName, parentCategory = null, level = 0) {
//   const isLeafLevel = level >= 3;
  
//   let prompt = `Create a category structure for "${categoryName}"${parentCategory ? ` under parent category "${parentCategory}"` : ""} for a rental platform.

// IMPORTANT: Return ONLY valid JSON. No markdown, no explanations, no extra text.

// CRITICAL RULES:
// - Attributes should ONLY be added at the LEAF level (deepest subcategories with hasChildren: false)
// - Parent categories should NOT have attributes
// - Maximum depth: 4 levels
// - Level 0: Main category (no attributes)
// - Level 1: Sub-category (no attributes)  
// - Level 2: Sub-sub-category (no attributes)
// - Level 3/4: Leaf category (has attributes, no further children)

// Use this exact structure:

// {
//   "mainCategory": {
//     "name": "${categoryName}",
//     "description": "Brief description",
//     "iconSuggestion": "📦",
//     "colorScheme": "#3B82F6"
//   },
//   "subCategories": [
//     {
//       "name": "Category Name",
//       "description": "Brief description",
//       "hasChildren": true,
//       "children": [
//         {
//           "name": "Leaf Category Name",
//           "description": "Description",
//           "hasChildren": false,
//           "attributes": [
//             {
//               "name": "Brand",
//               "type": "select",
//               "required": true,
//               "filterable": true,
//               "options": ["Brand A", "Brand B", "Brand C"]
//             },
//             {
//               "name": "Condition",
//               "type": "select", 
//               "required": true,
//               "filterable": true,
//               "options": ["New", "Like New", "Good", "Fair"]
//             }
//           ],
//           "typicalProducts": ["Product 1", "Product 2"]
//         }
//       ]
//     },
    
//   ]
// }`;

//   if (!isLeafLevel) {
//     prompt += `\n\nREMINDER: This is level ${level}. Do NOT add attributes at this level. Only add attributes at leaf level (hasChildren: false).`;
//   }

//   return prompt;
// }

/**
 * Build prompt for category generation based on level
 */
function buildCategoryPrompt(categoryName, parentCategory = null, level = 0) {
  const isLeafLevel = level >= 2; // Level 2+ are leaf levels (no children)
  console.log(`Building prompt for category: ${categoryName}, level: ${level}, isLeafLevel: ${isLeafLevel}`)
  let prompt = `Create a category structure for "${categoryName}"${parentCategory ? ` under parent category "${parentCategory}"` : ""} for a rental platform.

IMPORTANT: Return ONLY valid JSON. No markdown, no explanations, no extra text.

`;

  // Level 0 - Main category (can have children, no attributes)
  if (level === 0) {
    prompt += `This is a TOP-LEVEL category (Level 0)
- It can have subcategories
- It should NOT have any attributes
- Provide 2-3 relevant subcategories

Use this exact structure:
{
  "mainCategory": {
    "name": "${categoryName}",
    "description": "Brief description of this category",
    "iconSuggestion": "📦",
    "colorScheme": "#3B82F6",
    "keywords": ["keyword1", "keyword2"]
  },
  "subCategories": [
    {
      "name": "Subcategory 1",
      "description": "Brief description",
      "hasChildren": true,
      "children": [
        {
          "name": "Leaf Category 1",
          "description": "Description",
          "hasChildren": false,
          "attributes": [
            {
              "name": "Brand",
              "type": "select",
              "required": true,
              "filterable": true,
              "options": ["Brand A", "Brand B", "Brand C"]
            }
          ]
        }
      ]
    }
  ]
}`;
  }
  // Level 1 - Subcategory (can have children, no attributes)
  else if (level === 1) {
    prompt += `This is a SUB-CATEGORY (Level 1)
- It can have child subcategories
- It should NOT have any attributes
- Provide 2-3 relevant child categories

Use this exact structure:
{
  "mainCategory": {
    "name": "${categoryName}",
    "description": "Brief description of this subcategory",
    "iconSuggestion": "📦",
    "colorScheme": "#3B82F6",
    "keywords": ["keyword1", "keyword2"]
  },
  "subCategories": [
    {
      "name": "Child Category 1",
      "description": "Description",
      "hasChildren": true,
      "children": [
        {
          "name": "Leaf Category 1",
          "description": "Description",
          "hasChildren": false,
          "attributes": [
            {
              "name": "Brand",
              "type": "select",
              "required": true,
              "filterable": true,
              "options": ["Option 1", "Option 2"]
            }
          ]
        }
      ]
    }
  ]
}`;
  }
  // Level 2+ - LEAF category (NO children, HAS attributes)
  else {
    prompt += `⚠️ IMPORTANT: This is a LEAF CATEGORY (Level ${level})
- This is the FINAL level in the category hierarchy
- It MUST NOT have any subcategories (no children, no subCategories)
- It SHOULD have attributes for product filtering
- Return ONLY the category itself with its attributes

Use this EXACT structure (NO nested objects, just the category itself):
{
  "mainCategory": {
    "name": "${categoryName}",
    "description": "Detailed description of this leaf category",
    "iconSuggestion": "📦",
    "colorScheme": "#3B82F6",
    "keywords": ["keyword1", "keyword2", "keyword3"]
  },
  "attributes": [
    {
      "name": "Brand",
      "type": "select",
      "required": true,
      "filterable": true,
      "options": ["Samsung", "Google", "OnePlus", "Xiaomi", "Motorola"]
    },
    {
      "name": "Condition",
      "type": "select",
      "required": true,
      "filterable": true,
      "options": ["New", "Like New", "Excellent", "Good"]
    },
    {
      "name": "RAM",
      "type": "select",
      "required": false,
      "filterable": true,
      "options": ["4GB", "6GB", "8GB", "12GB", "16GB"]
    },
    {
      "name": "Storage",
      "type": "select",
      "required": false,
      "filterable": true,
      "options": ["64GB", "128GB", "256GB", "512GB"]
    },
    {
      "name": "Battery Health",
      "type": "select",
      "required": false,
      "filterable": true,
      "options": ["90%+", "80%+", "70%+", "60%+"]
    }
  ],
  "typicalProducts": ["Samsung Galaxy S24", "Google Pixel 8", "OnePlus 12", "Xiaomi 14 Pro"]
}

REMEMBER: 
- DO NOT include "subCategories" array
- DO NOT include "children" array
- ONLY include "mainCategory" and "attributes"`;
  }

  return prompt;
}


/**
 * Process subcategories to ensure attributes only at leaf level
 */
function processSubCategoriesForAttributes(subCategories, level = 1) {
  if (!Array.isArray(subCategories) || subCategories.length === 0) {
    return getDefaultSubcategoriesWithLeafOnly();
  }
  
  return subCategories.map(sub => {
    const hasChildren = sub.hasChildren === true || (sub.children && sub.children.length > 0);
    
    if (hasChildren) {
      // Parent category - NO attributes
      const processedChildren = sub.children && sub.children.length > 0
        ? processSubCategoriesForAttributes(sub.children, level + 1)
        : [];
      
      return {
        name: sub.name || "Category",
        description: sub.description || "",
        hasChildren: true,
        attributes: [], // NO attributes at parent level
        children: processedChildren,
        typicalProducts: [],
      };
    } else {
      // Leaf category - HAS attributes
      return {
        name: sub.name || "Category",
        description: sub.description || "",
        hasChildren: false,
        attributes: processAttributes(sub.attributes || getDefaultAttributesForCategory(sub.name)),
        children: [],
        typicalProducts: Array.isArray(sub.typicalProducts) ? sub.typicalProducts : [],
      };
    }
  });
}

/**
 * Process and validate attributes
 */
function processAttributes(attributes) {
  if (!Array.isArray(attributes) || attributes.length === 0) {
    return getDefaultAttributesForCategory();
  }
  
  // Limit to 6 attributes max
  const limitedAttributes = attributes.slice(0, 6);
  
  return limitedAttributes.map(attr => ({
    name: attr.name || "Attribute",
    type: ["text", "number", "boolean", "select", "multiselect"].includes(attr.type) ? attr.type : "text",
    required: attr.required === true,
    filterable: attr.filterable !== false,
    options: Array.isArray(attr.options) ? attr.options.slice(0, 10) : [],
    unit: attr.unit || "",
  }));
}

/**
 * Get default attributes for leaf categories
 */
function getDefaultAttributesForCategory(categoryName = "") {
  const categoryLower = categoryName.toLowerCase();
  
  // Furniture category attributes
  if (categoryLower.includes("furniture") || categoryLower.includes("sofa") || 
      categoryLower.includes("table") || categoryLower.includes("chair") || 
      categoryLower.includes("bed") || categoryLower.includes("wardrobe")) {
    return [
      { name: "Material", type: "select", required: true, filterable: true, options: ["Wood", "Metal", "Fabric", "Glass", "Plastic"] },
      { name: "Color", type: "select", required: false, filterable: true, options: ["Brown", "Black", "White", "Grey", "Blue"] },
      { name: "Dimensions", type: "text", required: false, filterable: false, unit: "cm" },
      { name: "Assembly Required", type: "boolean", required: false, filterable: true },
      { name: "Warranty", type: "text", required: false, filterable: false },
    ];
  }
  
  // Electronics category attributes
  if (categoryLower.includes("electronics") || categoryLower.includes("laptop") || 
      categoryLower.includes("mobile") || categoryLower.includes("phone") || 
      categoryLower.includes("tv") || categoryLower.includes("computer")) {
    return [
      { name: "Brand", type: "select", required: true, filterable: true, options: ["Apple", "Samsung", "Dell", "HP", "Lenovo", "Sony"] },
      { name: "Condition", type: "select", required: true, filterable: true, options: ["New", "Like New", "Excellent", "Good"] },
      { name: "RAM", type: "text", required: false, filterable: true, unit: "GB" },
      { name: "Storage", type: "text", required: false, filterable: true, unit: "GB" },
      { name: "Warranty", type: "text", required: false, filterable: false },
    ];
  }
  
  // Home Appliances attributes
  if (categoryLower.includes("appliance") || categoryLower.includes("refrigerator") || 
      categoryLower.includes("washing") || categoryLower.includes("ac") || 
      categoryLower.includes("microwave") || categoryLower.includes("oven")) {
    return [
      { name: "Brand", type: "select", required: true, filterable: true, options: ["Samsung", "LG", "Whirlpool", "Godrej", "Voltas", "Panasonic"] },
      { name: "Energy Rating", type: "select", required: false, filterable: true, options: ["5 Star", "4 Star", "3 Star", "2 Star"] },
      { name: "Capacity", type: "text", required: false, filterable: true, unit: "L/kg" },
      { name: "Condition", type: "select", required: true, filterable: true, options: ["New", "Like New", "Good"] },
    ];
  }
  
  // Default attributes
  return [
    { name: "Brand", type: "select", required: true, filterable: true, options: ["Premium", "Standard", "Economy"] },
    { name: "Condition", type: "select", required: true, filterable: true, options: ["New", "Like New", "Good", "Fair"] },
    { name: "Warranty", type: "text", required: false, filterable: false },
  ];
}

/**
 * Get default subcategories with leaf-only attributes
 */
function getDefaultSubcategoriesWithLeafOnly(categoryName = "") {
  return [
    {
      name: `Premium ${categoryName}`,
      description: `High-end ${categoryName} products for premium experience`,
      hasChildren: false,
      attributes: getDefaultAttributesForCategory(categoryName),
      typicalProducts: [`Premium ${categoryName} Item 1`, `Premium ${categoryName} Item 2`],
    },
    {
      name: `Standard ${categoryName}`,
      description: `Affordable ${categoryName} products for everyday needs`,
      hasChildren: false,
      attributes: getDefaultAttributesForCategory(categoryName),
      typicalProducts: [`Standard ${categoryName} Item`],
    },
  ];
}

/**
 * Parse AI response and ensure attributes only at leaf level
 */
// function parseAICategoryResponse(response, categoryName) {
//   try {
//     console.log("📝 Parsing AI response...");
    
//     const cleanedJson = extractJSONFromResponse(response);
//     if (!cleanedJson) {
//       console.warn("⚠️ Could not extract valid JSON, using fallback");
//       return getFallbackCategoryData(categoryName);
//     }
    
//     let parsed;
//     try {
//       parsed = JSON.parse(cleanedJson);
//       console.log("✅ JSON parsed successfully");
//     } catch (e) {
//       console.error("JSON parse error:", e.message);
//       return getFallbackCategoryData(categoryName);
//     }
    
//     if (!parsed.mainCategory) {
//       console.warn("Missing mainCategory in response");
//       return getFallbackCategoryData(categoryName);
//     }
    
//     // Process subcategories to ensure attributes only at leaf level
//     const processedSubCategories = processSubCategoriesForAttributes(parsed.subCategories || []);
    
//     const validatedData = {
//       mainCategory: {
//         name: parsed.mainCategory.name || categoryName,
//         description: parsed.mainCategory.description || `Products related to ${categoryName}`,
//         iconSuggestion: parsed.mainCategory.iconSuggestion || getDefaultIcon(categoryName),
//         colorScheme: parsed.mainCategory.colorScheme || "#3B82F6",
//         keywords: Array.isArray(parsed.mainCategory.keywords) ? parsed.mainCategory.keywords : [categoryName.toLowerCase()],
//       },
//       subCategories: processedSubCategories,
//       generatedAt: new Date().toISOString(),
//     };
    
//     console.log("✅ Successfully validated AI response");
//     return { success: true, data: validatedData };
//   } catch (error) {
//     console.error("❌ Error parsing AI response:", error.message);
//     return getFallbackCategoryData(categoryName);
//   }
// }

function parseAICategoryResponse(response, categoryName, level = 0) {
  try {
    console.log(`📝 Parsing AI response for level ${level}...`);
    
    const cleanedJson = extractJSONFromResponse(response);
    if (!cleanedJson) {
      console.warn("⚠️ Could not extract valid JSON, using fallback");
      return getFallbackCategoryData(categoryName, level);
    }
    
    let parsed;
    try {
      parsed = JSON.parse(cleanedJson);
      console.log("✅ JSON parsed successfully");
      console.log("📊 Parsed structure:", Object.keys(parsed));
    } catch (e) {
      console.error("JSON parse error:", e.message);
      return getFallbackCategoryData(categoryName, level);
    }
    
    if (!parsed.mainCategory) {
      console.warn("Missing mainCategory in response");
      return getFallbackCategoryData(categoryName, level);
    }
    
    // Build validated data based on level
    let validatedData = {
      mainCategory: {
        name: parsed.mainCategory.name || categoryName,
        description: parsed.mainCategory.description || `Products related to ${categoryName}`,
        iconSuggestion: parsed.mainCategory.iconSuggestion || getDefaultIcon(categoryName),
        colorScheme: parsed.mainCategory.colorScheme || "#3B82F6",
        keywords: Array.isArray(parsed.mainCategory.keywords) ? parsed.mainCategory.keywords : [categoryName.toLowerCase()],
      },
      generatedAt: new Date().toISOString(),
    };
    
    // For leaf levels (2+), add attributes directly (NO subcategories)
    if (level >= 2) {
      validatedData.attributes = processAttributes(parsed.attributes || getDefaultAttributesForCategory(categoryName));
      validatedData.typicalProducts = parsed.typicalProducts || getDefaultTypicalProducts(categoryName);
      validatedData.subCategories = []; // Explicitly set empty array
      console.log(`📦 Leaf category: ${validatedData.mainCategory.name} with ${validatedData.attributes.length} attributes`);
    } 
    // For parent levels (0-1), process subcategories
    else {
      validatedData.subCategories = processSubCategoriesForAttributes(parsed.subCategories || [], level + 1);
      console.log(`📁 Parent category: ${validatedData.mainCategory.name} with ${validatedData.subCategories.length} subcategories`);
    }
    
    console.log("✅ Successfully validated AI response");
    return { success: true, data: validatedData };
  } catch (error) {
    console.error("❌ Error parsing AI response:", error.message);
    return getFallbackCategoryData(categoryName, level);
  }
}

function getDefaultTypicalProducts(categoryName) {
  const categoryLower = categoryName.toLowerCase();
  
  if (categoryLower.includes("android") || categoryLower.includes("phone")) {
    return ["Samsung Galaxy S24", "Google Pixel 8", "OnePlus 12", "Xiaomi 14 Pro", "Motorola Edge"];
  }
  if (categoryLower.includes("laptop") || categoryLower.includes("computer")) {
    return ["Dell XPS 15", "MacBook Pro", "Lenovo ThinkPad", "HP Spectre", "Asus ROG"];
  }
  if (categoryLower.includes("tv") || categoryLower.includes("television")) {
    return ["Samsung QLED", "LG OLED", "Sony Bravia", "Mi TV", "OnePlus TV"];
  }
  if (categoryLower.includes("furniture") || categoryLower.includes("sofa")) {
    return ["L-Shape Sofa", "3-Seater Sofa", "Recliner Sofa", "Sectional Sofa"];
  }
  
  return [`${categoryName} Item 1`, `${categoryName} Item 2`, `${categoryName} Item 3`];
}


/**
 * Get default icon for category
 */
function getDefaultIcon(categoryName) {
  const iconMap = {
    furniture: "🛋️", sofa: "🛋️", chair: "🪑", table: "🪑", bed: "🛏️", mattress: "🛏️",
    wardrobe: "🚪", storage: "📦", electronics: "📱", mobile: "📱", phone: "📱", 
    laptop: "💻", computer: "🖥️", tv: "📺", television: "📺", audio: "🔊", 
    appliances: "🔌", refrigerator: "🧊", washing: "🧺", ac: "❄️", microwave: "🔥",
    kitchen: "🍳", clothing: "👕", fashion: "👗", shoes: "👟", accessories: "💍",
    books: "📚", sports: "⚽", fitness: "💪", toys: "🧸", baby: "👶", 
    automotive: "🚗", tools: "🔧", garden: "🌱", pets: "🐕", office: "📎"
  };
  
  const lowerName = categoryName.toLowerCase();
  for (const [key, icon] of Object.entries(iconMap)) {
    if (lowerName.includes(key)) {
      return icon;
    }
  }
  return "📦";
}

/**
 * Get fallback category data
 */
// function getFallbackCategoryData(categoryName) {
//   console.log(`📦 Using fallback data for category: ${categoryName}`);
  
//   return {
//     success: true,
//     data: {
//       mainCategory: {
//         name: categoryName,
//         description: `Quality ${categoryName} available for rent on flexible terms.`,
//         iconSuggestion: getDefaultIcon(categoryName),
//         colorScheme: "#3B82F6",
//       },
//       subCategories: getDefaultSubcategoriesWithLeafOnly(categoryName),
//       generatedAt: new Date().toISOString(),
//     },
//   };
// }

function getFallbackCategoryData(categoryName, level = 0) {
  console.log(`📦 Using fallback data for category: ${categoryName} at level ${level}`);
  
  const baseData = {
    success: true,
    data: {
      mainCategory: {
        name: categoryName,
        description: `Quality ${categoryName} available for rent on flexible terms.`,
        iconSuggestion: getDefaultIcon(categoryName),
        colorScheme: "#3B82F6",
      },
      generatedAt: new Date().toISOString(),
    },
  };
  
  // For leaf levels (2+), add attributes
  if (level >= 2) {
    baseData.data.attributes = getDefaultAttributesForCategory(categoryName);
    baseData.data.typicalProducts = [`${categoryName} Item 1`, `${categoryName} Item 2`];
    baseData.data.subCategories = [];
  } 
  // For parent levels, add default subcategories
  else {
    baseData.data.subCategories = getDefaultSubcategoriesWithLeafOnly(categoryName);
  }
  
  return baseData;
}

/**
 * Generate category suggestions using Mistral AI
 */
// async function generateCategorySuggestions(categoryName, parentCategory = null, level = 0) {
//   try {
//     const cacheKey = `ai:category:suggestions:${categoryName}:${parentCategory || "root"}:level${level}`;

//     if (redisClient) {
//       const cached = await redisClient.get(cacheKey);
//       if (cached) {
//         console.log("📦 Returning cached result");
//         return JSON.parse(cached);
//       }
//     }

//     const prompt = buildCategoryPrompt(categoryName, parentCategory, level);
//     console.log(`📤 Generating category for: ${categoryName} at level ${level} using Mistral AI`);

//     let text;
//     try {
//       text = await generateWithMistral(prompt);
//       console.log(`📥 Response received (${text.length} chars)`);
//     } catch (error) {
//       console.error("Mistral AI request failed:", error.message);
//       return getFallbackCategoryData(categoryName);
//     }

//     const suggestions = parseAICategoryResponse(text, categoryName);

//     if (redisClient && suggestions.success) {
//       await redisClient.setex(cacheKey, cacheTTL, JSON.stringify(suggestions));
//     }

//     return suggestions;
//   } catch (error) {
//     logger.error("Error generating category suggestions:", error.message);
//     return getFallbackCategoryData(categoryName);
//   }
// }

async function generateCategorySuggestions(categoryName, parentCategory = null, level = 0) {
  try {
    const cacheKey = `ai:category:suggestions:${categoryName}:${parentCategory || "root"}:level${level}`;

    if (redisClient) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        console.log("📦 Returning cached result");
        return JSON.parse(cached);
      }
    }

    const prompt = buildCategoryPrompt(categoryName, parentCategory, level);
    console.log(`📝 Prompt: ${prompt}`);
    console.log(`📤 Generating category for: ${categoryName} at level ${level} using Mistral AI`);
    // console.log(`📝 Prompt length: ${prompt.length} chars`);
    

    let text;
    try {
      console.log("prompt-->", prompt)
      text = await generateWithMistral(prompt);

      console.log("raw response-->", text)
      console.log(`📥 Response received (${text.length} chars)`);
      // Log first 500 chars for debugging
      console.log(`📄 Response preview: ${text.substring(0, 500)}...`);
    } catch (error) {
      console.error("Mistral AI request failed:", error.message);
      return getFallbackCategoryData(categoryName, level);
    }

    const suggestions = parseAICategoryResponse(text, categoryName, level);

    if (redisClient && suggestions.success) {
      await redisClient.setex(cacheKey, cacheTTL, JSON.stringify(suggestions));
    }

    return suggestions;
  } catch (error) {
    logger.error("Error generating category suggestions:", error.message);
    return getFallbackCategoryData(categoryName, level);
  }
}

/**
 * Save AI-generated category with proper leaf-level attribute handling
 */
// async function saveCategoryFromAI(categoryData, userId) {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const { mainCategory, subCategories } = categoryData;
//     if (!mainCategory?.name) throw new Error("Category name is required");

//     // Generate unique slug
//     let slug = mainCategory.name.toLowerCase()
//       .replace(/[^a-z0-9]+/g, "-")
//       .replace(/^-|-$/g, "");
    
//     let existingCategory = await Category.findOne({ slug }).session(session);
//     let counter = 1;
//     while (existingCategory) {
//       slug = `${mainCategory.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${counter}`;
//       existingCategory = await Category.findOne({ slug }).session(session);
//       counter++;
//     }

//     // Create main category (Level 0) - NO attributes
//     const category = await Category.create([{
//       name: mainCategory.name,
//       description: mainCategory.description || `Products related to ${mainCategory.name}`,
//       slug: slug,
//       parent: null,
//       icon: mainCategory.iconSuggestion || getDefaultIcon(mainCategory.name),
//       image: mainCategory.iconUrl ? { url: mainCategory.iconUrl } : null,
//       attributes: [], // NO attributes at parent level
//       isActive: true,
//       displayOrder: 0,
//       level: 0,
//       ancestors: [],
//       metadata: { 
//         createdBy: userId, 
//         aiGenerated: true, 
//         generatedAt: new Date() 
//       },
//     }], { session });

//     // Recursively save subcategories
//     if (subCategories && subCategories.length > 0) {
//       await saveSubCategoriesRecursively(subCategories, category[0]._id, userId, session, 1);
//     }

//     await session.commitTransaction();
//     return category[0];
//   } catch (error) {
//     await session.abortTransaction();
//     logger.error("Error saving AI-generated category:", error);
//     throw error;
//   } finally {
//     session.endSession();
//   }
// }

/**
 * Save AI-generated category based on level
 */
async function saveCategoryFromAI(categoryData, userId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { mainCategory, attributes, subCategories, typicalProducts } = categoryData;
    if (!mainCategory?.name) throw new Error("Category name is required");

    // Determine if this is a leaf category (has attributes and no subcategories)
    const isLeafCategory = (attributes && attributes.length > 0) || (!subCategories || subCategories.length === 0);
    
    console.log(`💾 Saving category: ${mainCategory.name}, isLeaf: ${isLeafCategory}, attributes: ${attributes?.length || 0}`);
    
    // Generate unique slug
    let slug = mainCategory.name.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    
    let existingCategory = await Category.findOne({ slug }).session(session);
    let counter = 1;
    while (existingCategory) {
      slug = `${mainCategory.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${counter}`;
      existingCategory = await Category.findOne({ slug }).session(session);
      counter++;
    }

    // Create main category
    const category = await Category.create([{
      name: mainCategory.name,
      description: mainCategory.description || `Products related to ${mainCategory.name}`,
      slug: slug,
      parent: null,
      icon: mainCategory.iconSuggestion || getDefaultIcon(mainCategory.name),
      image: mainCategory.iconUrl ? { url: mainCategory.iconUrl } : null,
      attributes: isLeafCategory ? (attributes || getDefaultAttributesForCategory(mainCategory.name)) : [],
      isActive: true,
      displayOrder: 0,
      level: 0,
      ancestors: [],
      metadata: { 
        createdBy: userId, 
        aiGenerated: true, 
        generatedAt: new Date(),
        isLeafCategory,
        typicalProducts: isLeafCategory ? typicalProducts : []
      },
    }], { session });

    // Save subcategories only if not leaf and subcategories exist
    if (!isLeafCategory && subCategories && subCategories.length > 0) {
      console.log(`📁 Saving ${subCategories.length} subcategories for ${mainCategory.name}`);
      await saveSubCategoriesRecursively(subCategories, category[0]._id, userId, session, 1);
    }

    await session.commitTransaction();
    return category[0];
  } catch (error) {
    await session.abortTransaction();
    logger.error("Error saving AI-generated category:", error);
    throw error;
  } finally {
    session.endSession();
  }
}


/**
 * Recursively save subcategories with attributes only at leaf level
 */
async function saveSubCategoriesRecursively(subCategories, parentId, userId, session, currentLevel) {
  for (const subCat of subCategories) {
    if (!subCat.name) continue;
    
    const hasChildren = subCat.hasChildren === true || (subCat.children && subCat.children.length > 0);
    const isLeafLevel = !hasChildren;
    
    // Generate unique slug
    let slug = subCat.name.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    
    let existingCategory = await Category.findOne({ slug, parent: parentId }).session(session);
    let counter = 1;
    while (existingCategory) {
      slug = `${subCat.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${counter}`;
      existingCategory = await Category.findOne({ slug, parent: parentId }).session(session);
      counter++;
    }
    
    // Create category - attributes ONLY at leaf level
    const newCategory = await Category.create([{
      name: subCat.name,
      description: subCat.description || "",
      slug: slug,
      parent: parentId,
      icon: subCat.iconSuggestion || "📄",
      attributes: isLeafLevel ? (subCat.attributes || getDefaultAttributesForCategory(subCat.name)) : [],
      isActive: true,
      level: currentLevel,
      metadata: { 
        createdBy: userId, 
        aiGenerated: true, 
        parentSuggestion: true,
        isLeafLevel: isLeafLevel
      },
    }], { session });
    
    // Recursively save children if any
    if (hasChildren && subCat.children && subCat.children.length > 0) {
      await saveSubCategoriesRecursively(subCat.children, newCategory[0]._id, userId, session, currentLevel + 1);
    }
  }
}

/**
 * Generate category icon (placeholder - can be enhanced with actual AI image generation)
 */
async function generateCategoryIcon(categoryName, description = "") {
  const icon = getDefaultIcon(categoryName);
  return {
    success: true,
    url: `https://via.placeholder.com/100x100?text=${encodeURIComponent(icon)}`,
    thumbnail: `https://via.placeholder.com/100x100?text=${encodeURIComponent(icon)}`,
    metadata: { 
      category: categoryName, 
      generatedBy: "Fallback", 
      timestamp: new Date().toISOString() 
    },
  };
}

/**
 * Generate icon variations
 */
async function generateIconVariations(categoryName, description = "", count = 4) {
  const icon = getDefaultIcon(categoryName);
  const variations = [];
  
  for (let i = 0; i < Math.min(count, 6); i++) {
    variations.push({
      success: true,
      url: `https://via.placeholder.com/100x100?text=${encodeURIComponent(icon)}&variant=${i+1}`,
      thumbnail: `https://via.placeholder.com/100x100?text=${encodeURIComponent(icon)}&variant=${i+1}`,
    });
  }
  
  return { success: true, variations, count: variations.length };
}

// Export all functions
module.exports = {
  generateCategorySuggestions,
  generateCategoryIcon,
  generateIconVariations,
  saveCategoryFromAI,
  getDefaultIcon,
  getFallbackCategoryData,
};