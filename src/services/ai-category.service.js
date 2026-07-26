
// // services/ai-category.service.js
// const axios = require("axios");
// const mongoose = require("mongoose");
// const logger = require("../config/logger");
// const { Category } = require("../models");
// const { getRedisClient } = require("../config/redis");

// // Redis client
// const redisClient = getRedisClient();
// const cacheTTL = 3600; // 1 hour

// // Mistral API configuration
// const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
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
//             content: "You are an expert e-commerce category structure designer for a rental platform. Return ONLY valid JSON. No markdown, no explanations, no extra text." 
//           },
//           { role: "user", content: prompt }
//         ],
//         temperature: 0.3,
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
  
//   // Remove markdown code blocks
//   let cleaned = text.replace(/```json\s*/g, "");
//   cleaned = cleaned.replace(/```\s*/g, "");
  
//   // Find JSON object
//   let jsonMatch = cleaned.match(/\{[\s\S]*\}/);
//   if (!jsonMatch) {
//     console.warn("No JSON object found");
//     return null;
//   }
  
//   let jsonString = jsonMatch[0];
  
//   // Try direct parse
//   try {
//     JSON.parse(jsonString);
//     console.log("✅ Direct JSON parse successful");
//     return jsonString;
//   } catch (e) {
//     console.log("Direct parse failed, trying repairs...");
//   }
  
//   // Fix common JSON issues
//   jsonString = fixCommonJSONErrors(jsonString);
//   try {
//     JSON.parse(jsonString);
//     console.log("✅ Fixed JSON parse successful");
//     return jsonString;
//   } catch (e) {
//     console.log("Fixed parse failed");
//   }
  
//   console.error("❌ All JSON extraction strategies failed");
//   return null;
// }

// /**
//  * Fix common JSON errors
//  */
// function fixCommonJSONErrors(jsonString) {
//   let fixed = jsonString;
  
//   // Fix trailing commas
//   fixed = fixed.replace(/,\s*}/g, "}");
//   fixed = fixed.replace(/,\s*\]/g, "]");
  
//   // Fix unquoted property names
//   fixed = fixed.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
  
//   // Fix single quotes
//   fixed = fixed.replace(/'/g, '"');
  
//   return fixed;
// }


// /**
//  * Build prompt for category generation based on level
//  */
// function buildCategoryPrompt(categoryName, parentCategory = null, level = 0) {
//   const isLeafLevel = level >= 2; // Level 2+ are leaf levels (no children)
//   console.log(`Building prompt for category: ${categoryName}, level: ${level}, isLeafLevel: ${isLeafLevel}`)
//   let prompt = `Create a category structure for "${categoryName}"${parentCategory ? ` under parent category "${parentCategory}"` : ""} for a rental platform.

// IMPORTANT: Return ONLY valid JSON. No markdown, no explanations, no extra text.

// `;

//   // Level 0 - Main category (can have children, no attributes)
//   if (level === 0) {
//     prompt += `This is a TOP-LEVEL category (Level 0)
// - It can have subcategories
// - It should NOT have any attributes
// - Provide 2-3 relevant subcategories

// Use this exact structure:
// {
//   "mainCategory": {
//     "name": "${categoryName}",
//     "description": "Brief description of this category",
//     "iconSuggestion": "📦",
//     "colorScheme": "#3B82F6",
//     "keywords": ["keyword1", "keyword2"]
//   },
//   "subCategories": [
//     {
//       "name": "Subcategory 1",
//       "description": "Brief description",
//       "hasChildren": true,
//       "children": [
//         {
//           "name": "Leaf Category 1",
//           "description": "Description",
//           "hasChildren": false,
//           "attributes": [
//             {
//               "name": "Brand",
//               "type": "select",
//               "required": true,
//               "filterable": true,
//               "options": ["Brand A", "Brand B", "Brand C"]
//             }
//           ]
//         }
//       ]
//     }
//   ]
// }`;
//   }
//   // Level 1 - Subcategory (can have children, no attributes)
//   else if (level === 1) {
//     prompt += `This is a SUB-CATEGORY (Level 1)
// - It can have child subcategories
// - It should NOT have any attributes
// - Provide 2-3 relevant child categories

// Use this exact structure:
// {
//   "mainCategory": {
//     "name": "${categoryName}",
//     "description": "Brief description of this subcategory",
//     "iconSuggestion": "📦",
//     "colorScheme": "#3B82F6",
//     "keywords": ["keyword1", "keyword2"]
//   },
//   "subCategories": [
//     {
//       "name": "Child Category 1",
//       "description": "Description",
//       "hasChildren": true,
//       "children": [
//         {
//           "name": "Leaf Category 1",
//           "description": "Description",
//           "hasChildren": false,
//           "attributes": [
//             {
//               "name": "Brand",
//               "type": "select",
//               "required": true,
//               "filterable": true,
//               "options": ["Option 1", "Option 2"]
//             }
//           ]
//         }
//       ]
//     }
//   ]
// }`;
//   }
//   // Level 2+ - LEAF category (NO children, HAS attributes)
//   else {
//     prompt += `⚠️ IMPORTANT: This is a LEAF CATEGORY (Level ${level})
// - This is the FINAL level in the category hierarchy
// - It MUST NOT have any subcategories (no children, no subCategories)
// - It SHOULD have attributes for product filtering
// - Return ONLY the category itself with its attributes

// Use this EXACT structure (NO nested objects, just the category itself):
// {
//   "mainCategory": {
//     "name": "${categoryName}",
//     "description": "Detailed description of this leaf category",
//     "iconSuggestion": "📦",
//     "colorScheme": "#3B82F6",
//     "keywords": ["keyword1", "keyword2", "keyword3"]
//   },
//   "attributes": [
//     {
//       "name": "Brand",
//       "type": "select",
//       "required": true,
//       "filterable": true,
//       "options": ["Samsung", "Google", "OnePlus", "Xiaomi", "Motorola"]
//     },
//     {
//       "name": "Condition",
//       "type": "select",
//       "required": true,
//       "filterable": true,
//       "options": ["New", "Like New", "Excellent", "Good"]
//     },
//     {
//       "name": "RAM",
//       "type": "select",
//       "required": false,
//       "filterable": true,
//       "options": ["4GB", "6GB", "8GB", "12GB", "16GB"]
//     },
//     {
//       "name": "Storage",
//       "type": "select",
//       "required": false,
//       "filterable": true,
//       "options": ["64GB", "128GB", "256GB", "512GB"]
//     },
//     {
//       "name": "Battery Health",
//       "type": "select",
//       "required": false,
//       "filterable": true,
//       "options": ["90%+", "80%+", "70%+", "60%+"]
//     }
//   ],
//   "typicalProducts": ["Samsung Galaxy S24", "Google Pixel 8", "OnePlus 12", "Xiaomi 14 Pro"]
// }

// REMEMBER: 
// - DO NOT include "subCategories" array
// - DO NOT include "children" array
// - ONLY include "mainCategory" and "attributes"`;
//   }

//   return prompt;
// }


// /**
//  * Process subcategories to ensure attributes only at leaf level
//  */
// function processSubCategoriesForAttributes(subCategories, level = 1) {
//   if (!Array.isArray(subCategories) || subCategories.length === 0) {
//     return getDefaultSubcategoriesWithLeafOnly();
//   }
  
//   return subCategories.map(sub => {
//     const hasChildren = sub.hasChildren === true || (sub.children && sub.children.length > 0);
    
//     if (hasChildren) {
//       // Parent category - NO attributes
//       const processedChildren = sub.children && sub.children.length > 0
//         ? processSubCategoriesForAttributes(sub.children, level + 1)
//         : [];
      
//       return {
//         name: sub.name || "Category",
//         description: sub.description || "",
//         hasChildren: true,
//         attributes: [], // NO attributes at parent level
//         children: processedChildren,
//         typicalProducts: [],
//       };
//     } else {
//       // Leaf category - HAS attributes
//       return {
//         name: sub.name || "Category",
//         description: sub.description || "",
//         hasChildren: false,
//         attributes: processAttributes(sub.attributes || getDefaultAttributesForCategory(sub.name)),
//         children: [],
//         typicalProducts: Array.isArray(sub.typicalProducts) ? sub.typicalProducts : [],
//       };
//     }
//   });
// }

// /**
//  * Process and validate attributes
//  */
// function processAttributes(attributes) {
//   if (!Array.isArray(attributes) || attributes.length === 0) {
//     return getDefaultAttributesForCategory();
//   }
  
//   // Limit to 6 attributes max
//   const limitedAttributes = attributes.slice(0, 6);
  
//   return limitedAttributes.map(attr => ({
//     name: attr.name || "Attribute",
//     type: ["text", "number", "boolean", "select", "multiselect"].includes(attr.type) ? attr.type : "text",
//     required: attr.required === true,
//     filterable: attr.filterable !== false,
//     options: Array.isArray(attr.options) ? attr.options.slice(0, 10) : [],
//     unit: attr.unit || "",
//   }));
// }

// /**
//  * Get default attributes for leaf categories
//  */
// function getDefaultAttributesForCategory(categoryName = "") {
//   const categoryLower = categoryName.toLowerCase();
  
//   // Furniture category attributes
//   if (categoryLower.includes("furniture") || categoryLower.includes("sofa") || 
//       categoryLower.includes("table") || categoryLower.includes("chair") || 
//       categoryLower.includes("bed") || categoryLower.includes("wardrobe")) {
//     return [
//       { name: "Material", type: "select", required: true, filterable: true, options: ["Wood", "Metal", "Fabric", "Glass", "Plastic"] },
//       { name: "Color", type: "select", required: false, filterable: true, options: ["Brown", "Black", "White", "Grey", "Blue"] },
//       { name: "Dimensions", type: "text", required: false, filterable: false, unit: "cm" },
//       { name: "Assembly Required", type: "boolean", required: false, filterable: true },
//       { name: "Warranty", type: "text", required: false, filterable: false },
//     ];
//   }
  
//   // Electronics category attributes
//   if (categoryLower.includes("electronics") || categoryLower.includes("laptop") || 
//       categoryLower.includes("mobile") || categoryLower.includes("phone") || 
//       categoryLower.includes("tv") || categoryLower.includes("computer")) {
//     return [
//       { name: "Brand", type: "select", required: true, filterable: true, options: ["Apple", "Samsung", "Dell", "HP", "Lenovo", "Sony"] },
//       { name: "Condition", type: "select", required: true, filterable: true, options: ["New", "Like New", "Excellent", "Good"] },
//       { name: "RAM", type: "text", required: false, filterable: true, unit: "GB" },
//       { name: "Storage", type: "text", required: false, filterable: true, unit: "GB" },
//       { name: "Warranty", type: "text", required: false, filterable: false },
//     ];
//   }
  
//   // Home Appliances attributes
//   if (categoryLower.includes("appliance") || categoryLower.includes("refrigerator") || 
//       categoryLower.includes("washing") || categoryLower.includes("ac") || 
//       categoryLower.includes("microwave") || categoryLower.includes("oven")) {
//     return [
//       { name: "Brand", type: "select", required: true, filterable: true, options: ["Samsung", "LG", "Whirlpool", "Godrej", "Voltas", "Panasonic"] },
//       { name: "Energy Rating", type: "select", required: false, filterable: true, options: ["5 Star", "4 Star", "3 Star", "2 Star"] },
//       { name: "Capacity", type: "text", required: false, filterable: true, unit: "L/kg" },
//       { name: "Condition", type: "select", required: true, filterable: true, options: ["New", "Like New", "Good"] },
//     ];
//   }
  
//   // Default attributes
//   return [
//     { name: "Brand", type: "select", required: true, filterable: true, options: ["Premium", "Standard", "Economy"] },
//     { name: "Condition", type: "select", required: true, filterable: true, options: ["New", "Like New", "Good", "Fair"] },
//     { name: "Warranty", type: "text", required: false, filterable: false },
//   ];
// }

// /**
//  * Get default subcategories with leaf-only attributes
//  */
// function getDefaultSubcategoriesWithLeafOnly(categoryName = "") {
//   return [
//     {
//       name: `Premium ${categoryName}`,
//       description: `High-end ${categoryName} products for premium experience`,
//       hasChildren: false,
//       attributes: getDefaultAttributesForCategory(categoryName),
//       typicalProducts: [`Premium ${categoryName} Item 1`, `Premium ${categoryName} Item 2`],
//     },
//     {
//       name: `Standard ${categoryName}`,
//       description: `Affordable ${categoryName} products for everyday needs`,
//       hasChildren: false,
//       attributes: getDefaultAttributesForCategory(categoryName),
//       typicalProducts: [`Standard ${categoryName} Item`],
//     },
//   ];
// }


// function parseAICategoryResponse(response, categoryName, level = 0) {
//   try {
//     console.log(`📝 Parsing AI response for level ${level}...`);
    
//     const cleanedJson = extractJSONFromResponse(response);
//     if (!cleanedJson) {
//       console.warn("⚠️ Could not extract valid JSON, using fallback");
//       return getFallbackCategoryData(categoryName, level);
//     }
    
//     let parsed;
//     try {
//       parsed = JSON.parse(cleanedJson);
//       console.log("✅ JSON parsed successfully");
//       console.log("📊 Parsed structure:", Object.keys(parsed));
//     } catch (e) {
//       console.error("JSON parse error:", e.message);
//       return getFallbackCategoryData(categoryName, level);
//     }
    
//     if (!parsed.mainCategory) {
//       console.warn("Missing mainCategory in response");
//       return getFallbackCategoryData(categoryName, level);
//     }
    
//     // Build validated data based on level
//     let validatedData = {
//       mainCategory: {
//         name: parsed.mainCategory.name || categoryName,
//         description: parsed.mainCategory.description || `Products related to ${categoryName}`,
//         iconSuggestion: parsed.mainCategory.iconSuggestion || getDefaultIcon(categoryName),
//         colorScheme: parsed.mainCategory.colorScheme || "#3B82F6",
//         keywords: Array.isArray(parsed.mainCategory.keywords) ? parsed.mainCategory.keywords : [categoryName.toLowerCase()],
//       },
//       generatedAt: new Date().toISOString(),
//     };
    
//     // For leaf levels (2+), add attributes directly (NO subcategories)
//     if (level >= 2) {
//       validatedData.attributes = processAttributes(parsed.attributes || getDefaultAttributesForCategory(categoryName));
//       validatedData.typicalProducts = parsed.typicalProducts || getDefaultTypicalProducts(categoryName);
//       validatedData.subCategories = []; // Explicitly set empty array
//       console.log(`📦 Leaf category: ${validatedData.mainCategory.name} with ${validatedData.attributes.length} attributes`);
//     } 
//     // For parent levels (0-1), process subcategories
//     else {
//       validatedData.subCategories = processSubCategoriesForAttributes(parsed.subCategories || [], level + 1);
//       console.log(`📁 Parent category: ${validatedData.mainCategory.name} with ${validatedData.subCategories.length} subcategories`);
//     }
    
//     console.log("✅ Successfully validated AI response");
//     return { success: true, data: validatedData };
//   } catch (error) {
//     console.error("❌ Error parsing AI response:", error.message);
//     return getFallbackCategoryData(categoryName, level);
//   }
// }

// function getDefaultTypicalProducts(categoryName) {
//   const categoryLower = categoryName.toLowerCase();
  
//   if (categoryLower.includes("android") || categoryLower.includes("phone")) {
//     return ["Samsung Galaxy S24", "Google Pixel 8", "OnePlus 12", "Xiaomi 14 Pro", "Motorola Edge"];
//   }
//   if (categoryLower.includes("laptop") || categoryLower.includes("computer")) {
//     return ["Dell XPS 15", "MacBook Pro", "Lenovo ThinkPad", "HP Spectre", "Asus ROG"];
//   }
//   if (categoryLower.includes("tv") || categoryLower.includes("television")) {
//     return ["Samsung QLED", "LG OLED", "Sony Bravia", "Mi TV", "OnePlus TV"];
//   }
//   if (categoryLower.includes("furniture") || categoryLower.includes("sofa")) {
//     return ["L-Shape Sofa", "3-Seater Sofa", "Recliner Sofa", "Sectional Sofa"];
//   }
  
//   return [`${categoryName} Item 1`, `${categoryName} Item 2`, `${categoryName} Item 3`];
// }


// /**
//  * Get default icon for category
//  */
// function getDefaultIcon(categoryName) {
//   const iconMap = {
//     furniture: "🛋️", sofa: "🛋️", chair: "🪑", table: "🪑", bed: "🛏️", mattress: "🛏️",
//     wardrobe: "🚪", storage: "📦", electronics: "📱", mobile: "📱", phone: "📱", 
//     laptop: "💻", computer: "🖥️", tv: "📺", television: "📺", audio: "🔊", 
//     appliances: "🔌", refrigerator: "🧊", washing: "🧺", ac: "❄️", microwave: "🔥",
//     kitchen: "🍳", clothing: "👕", fashion: "👗", shoes: "👟", accessories: "💍",
//     books: "📚", sports: "⚽", fitness: "💪", toys: "🧸", baby: "👶", 
//     automotive: "🚗", tools: "🔧", garden: "🌱", pets: "🐕", office: "📎"
//   };
  
//   const lowerName = categoryName.toLowerCase();
//   for (const [key, icon] of Object.entries(iconMap)) {
//     if (lowerName.includes(key)) {
//       return icon;
//     }
//   }
//   return "📦";
// }

// function getFallbackCategoryData(categoryName, level = 0) {
//   console.log(`📦 Using fallback data for category: ${categoryName} at level ${level}`);
  
//   const baseData = {
//     success: true,
//     data: {
//       mainCategory: {
//         name: categoryName,
//         description: `Quality ${categoryName} available for rent on flexible terms.`,
//         iconSuggestion: getDefaultIcon(categoryName),
//         colorScheme: "#3B82F6",
//       },
//       generatedAt: new Date().toISOString(),
//     },
//   };
  
//   // For leaf levels (2+), add attributes
//   if (level >= 2) {
//     baseData.data.attributes = getDefaultAttributesForCategory(categoryName);
//     baseData.data.typicalProducts = [`${categoryName} Item 1`, `${categoryName} Item 2`];
//     baseData.data.subCategories = [];
//   } 
//   // For parent levels, add default subcategories
//   else {
//     baseData.data.subCategories = getDefaultSubcategoriesWithLeafOnly(categoryName);
//   }
  
//   return baseData;
// }


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
//     console.log(`📝 Prompt: ${prompt}`);
//     console.log(`📤 Generating category for: ${categoryName} at level ${level} using Mistral AI`);
//     // console.log(`📝 Prompt length: ${prompt.length} chars`);
    

//     let text;
//     try {
//       console.log("prompt-->", prompt)
//       text = await generateWithMistral(prompt);

//       console.log("raw response-->", text)
//       console.log(`📥 Response received (${text.length} chars)`);
//       // Log first 500 chars for debugging
//       console.log(`📄 Response preview: ${text.substring(0, 500)}...`);
//     } catch (error) {
//       console.error("Mistral AI request failed:", error.message);
//       return getFallbackCategoryData(categoryName, level);
//     }

//     const suggestions = parseAICategoryResponse(text, categoryName, level);

//     if (redisClient && suggestions.success) {
//       await redisClient.setex(cacheKey, cacheTTL, JSON.stringify(suggestions));
//     }

//     return suggestions;
//   } catch (error) {
//     logger.error("Error generating category suggestions:", error.message);
//     return getFallbackCategoryData(categoryName, level);
//   }
// }

// /**
//  * Save AI-generated category based on level
//  */
// async function saveCategoryFromAI(categoryData, userId) {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const { mainCategory, attributes, subCategories, typicalProducts } = categoryData;
//     if (!mainCategory?.name) throw new Error("Category name is required");

//     // Determine if this is a leaf category (has attributes and no subcategories)
//     const isLeafCategory = (attributes && attributes.length > 0) || (!subCategories || subCategories.length === 0);
    
//     console.log(`💾 Saving category: ${mainCategory.name}, isLeaf: ${isLeafCategory}, attributes: ${attributes?.length || 0}`);
    
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

//     // Create main category
//     const category = await Category.create([{
//       name: mainCategory.name,
//       description: mainCategory.description || `Products related to ${mainCategory.name}`,
//       slug: slug,
//       parent: null,
//       icon: mainCategory.iconSuggestion || getDefaultIcon(mainCategory.name),
//       image: mainCategory.iconUrl ? { url: mainCategory.iconUrl } : null,
//       attributes: isLeafCategory ? (attributes || getDefaultAttributesForCategory(mainCategory.name)) : [],
//       isActive: true,
//       displayOrder: 0,
//       level: 0,
//       ancestors: [],
//       metadata: { 
//         createdBy: userId, 
//         aiGenerated: true, 
//         generatedAt: new Date(),
//         isLeafCategory,
//         typicalProducts: isLeafCategory ? typicalProducts : []
//       },
//     }], { session });

//     // Save subcategories only if not leaf and subcategories exist
//     if (!isLeafCategory && subCategories && subCategories.length > 0) {
//       console.log(`📁 Saving ${subCategories.length} subcategories for ${mainCategory.name}`);
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


// /**
//  * Recursively save subcategories with attributes only at leaf level
//  */
// async function saveSubCategoriesRecursively(subCategories, parentId, userId, session, currentLevel) {
//   for (const subCat of subCategories) {
//     if (!subCat.name) continue;
    
//     const hasChildren = subCat.hasChildren === true || (subCat.children && subCat.children.length > 0);
//     const isLeafLevel = !hasChildren;
    
//     // Generate unique slug
//     let slug = subCat.name.toLowerCase()
//       .replace(/[^a-z0-9]+/g, "-")
//       .replace(/^-|-$/g, "");
    
//     let existingCategory = await Category.findOne({ slug, parent: parentId }).session(session);
//     let counter = 1;
//     while (existingCategory) {
//       slug = `${subCat.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${counter}`;
//       existingCategory = await Category.findOne({ slug, parent: parentId }).session(session);
//       counter++;
//     }
    
//     // Create category - attributes ONLY at leaf level
//     const newCategory = await Category.create([{
//       name: subCat.name,
//       description: subCat.description || "",
//       slug: slug,
//       parent: parentId,
//       icon: subCat.iconSuggestion || "📄",
//       attributes: isLeafLevel ? (subCat.attributes || getDefaultAttributesForCategory(subCat.name)) : [],
//       isActive: true,
//       level: currentLevel,
//       metadata: { 
//         createdBy: userId, 
//         aiGenerated: true, 
//         parentSuggestion: true,
//         isLeafLevel: isLeafLevel
//       },
//     }], { session });
    
//     // Recursively save children if any
//     if (hasChildren && subCat.children && subCat.children.length > 0) {
//       await saveSubCategoriesRecursively(subCat.children, newCategory[0]._id, userId, session, currentLevel + 1);
//     }
//   }
// }

// /**
//  * Generate category icon (placeholder - can be enhanced with actual AI image generation)
//  */
// async function generateCategoryIcon(categoryName, description = "") {
//   const icon = getDefaultIcon(categoryName);
//   return {
//     success: true,
//     url: `https://via.placeholder.com/100x100?text=${encodeURIComponent(icon)}`,
//     thumbnail: `https://via.placeholder.com/100x100?text=${encodeURIComponent(icon)}`,
//     metadata: { 
//       category: categoryName, 
//       generatedBy: "Fallback", 
//       timestamp: new Date().toISOString() 
//     },
//   };
// }

// /**
//  * Generate icon variations
//  */
// async function generateIconVariations(categoryName, description = "", count = 4) {
//   const icon = getDefaultIcon(categoryName);
//   const variations = [];
  
//   for (let i = 0; i < Math.min(count, 6); i++) {
//     variations.push({
//       success: true,
//       url: `https://via.placeholder.com/100x100?text=${encodeURIComponent(icon)}&variant=${i+1}`,
//       thumbnail: `https://via.placeholder.com/100x100?text=${encodeURIComponent(icon)}&variant=${i+1}`,
//     });
//   }
  
//   return { success: true, variations, count: variations.length };
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
 * Generate content using Mistral AI with retry logic
 */
async function generateWithMistral(prompt, retries = 2) {
  if (!MISTRAL_API_KEY) {
    throw new Error('Mistral API key not configured');
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(
        MISTRAL_API_URL,
        {
          model: "mistral-small-latest",
          messages: [
            { 
              role: "system", 
              content: `You are an expert e-commerce category designer for a rental platform. 
You MUST return ONLY valid JSON. No markdown, no code blocks, no explanations, no extra text.
Your response must start with '{' and end with '}'.
CRITICAL: Leaf categories (level 2+) MUST have 4-6 relevant attributes for product filtering.
Each attribute MUST have 3-8 realistic options.` 
            },
            { role: "user", content: prompt }
          ],
          temperature: 0.4,
          max_tokens: 4096,
          response_format: { type: "json_object" } // Force JSON if supported
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
      logger.error(`Mistral AI attempt ${attempt + 1} failed:`, error.response?.data || error.message);
      if (attempt === retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
    }
  }
}

/**
 * Robust JSON extraction with multiple strategies
 */
function extractJSONFromResponse(text) {
  console.log("🔍 Extracting JSON from AI response...");
  
  if (!text || typeof text !== 'string') {
    console.warn("⚠️ Empty or invalid response text");
    return null;
  }
  
  // Strategy 1: Try direct parse (cleanest response)
  try {
    const parsed = JSON.parse(text.trim());
    console.log("✅ Strategy 1: Direct parse successful");
    return JSON.stringify(parsed);
  } catch (e) {
    console.log("Strategy 1 failed, trying cleanup...");
  }
  
  // Strategy 2: Remove markdown code blocks
  let cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .replace(/`/g, "")
    .trim();
  
  try {
    const parsed = JSON.parse(cleaned);
    console.log("✅ Strategy 2: Markdown removal successful");
    return JSON.stringify(parsed);
  } catch (e) {
    console.log("Strategy 2 failed, trying regex extraction...");
  }
  
  // Strategy 3: Extract JSON object using regex (handles nested structures)
  const jsonMatch = cleaned.match(/\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\}))*\}))*\}/);
  if (jsonMatch) {
    let extracted = jsonMatch[0];
    try {
      const parsed = JSON.parse(extracted);
      console.log("✅ Strategy 3: Regex extraction successful");
      return JSON.stringify(parsed);
    } catch (e) {
      console.log("Strategy 3 failed, trying repairs...");
      extracted = fixCommonJSONErrors(extracted);
      try {
        const parsed = JSON.parse(extracted);
        console.log("✅ Strategy 4: Repaired JSON successful");
        return JSON.stringify(parsed);
      } catch (e2) {
        console.log("All strategies exhausted");
      }
    }
  }
  
  console.error("❌ All JSON extraction strategies failed");
  return null;
}

/**
 * Fix common JSON errors more robustly
 */
function fixCommonJSONErrors(jsonString) {
  let fixed = jsonString;
  
  // Remove trailing commas before closing brackets/braces
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
  
  // Fix unquoted property names (more precise regex)
  fixed = fixed.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g, '$1"$2"$3');
  
  // Fix single quotes to double quotes (but not inside already double-quoted strings)
  let inString = false;
  let escaped = false;
  let result = '';
  for (let i = 0; i < fixed.length; i++) {
    const char = fixed[i];
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      result += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }
    if (char === "'" && !inString) {
      result += '"';
      continue;
    }
    result += char;
  }
  
  // Fix missing commas between array elements or object properties
  result = result.replace(/}(\s*){/g, '},{');
  result = result.replace(/](\s*)\[/g, '],[');
  result = result.replace(/"(\s*)"/g, '","');
  
  return result;
}

/**
 * Dynamic prompt builder - no hardcoded examples
 */
function buildCategoryPrompt(categoryName, parentCategory = null, level = 0) {
  const isLeafLevel = level >= 2;
  const depthDescription = level === 0 ? "top-level" : level === 1 ? "mid-level" : "leaf-level";
  
  console.log(`📝 Building prompt for: "${categoryName}" (${depthDescription}, level ${level})`);
  
  let prompt = `Design a comprehensive category structure for "${categoryName}"`;
  
  if (parentCategory) {
    prompt += ` under parent "${parentCategory}"`;
  }
  
  prompt += ` in a product rental marketplace.

=== CATEGORY LEVEL: ${depthDescription.toUpperCase()} (Level ${level}) ===`;

  if (!isLeafLevel) {
    prompt += `

As a ${depthDescription} category, you can have subcategories but MUST NOT have product attributes.
Create a hierarchy with 2-4 relevant subcategories that make sense for rental products.

REQUIRED JSON STRUCTURE:
{
  "mainCategory": {
    "name": "exact category name",
    "description": "2-3 sentence description focused on rental use cases",
    "iconSuggestion": "single relevant emoji",
    "colorScheme": "hex color code that fits this category",
    "keywords": ["5-8", "relevant", "search", "terms"]
  },
  "subCategories": [
    {
      "name": "Subcategory Name",
      "description": "Brief description",
      "hasChildren": true/false,
      "children": []
    }
  ]
}`;

    if (level === 1) {
      prompt += `

IMPORTANT: If hasChildren is false for a subcategory, it becomes a LEAF category.
Leaf categories MUST include an "attributes" array with 4-6 relevant filtering attributes.
Leaf category example:
{
  "name": "Smartphones",
  "description": "Mobile phones for rent",
  "hasChildren": false,
  "attributes": [
    {
      "name": "Attribute Name",
      "type": "select",
      "required": true,
      "filterable": true,
      "options": ["Option1", "Option2", "Option3"]
    }
  ]
}`;
  }

  } else {
    prompt += `

CRITICAL: This is a LEAF CATEGORY - the final level with NO children.
You MUST generate product filtering attributes (4-6 attributes).
Each attribute helps renters filter and find the right product.

REQUIRED JSON STRUCTURE (NO subCategories field allowed):
{
  "mainCategory": {
    "name": "exact category name",
    "description": "Detailed 2-3 sentence description explaining what products are in this category and typical rental scenarios",
    "iconSuggestion": "single relevant emoji",
    "colorScheme": "hex color code",
    "keywords": ["5-8", "search", "terms", "specific", "to", "this", "category"]
  },
  "attributes": [
    {
      "name": "Attribute name relevant to this category",
      "type": "select or multiselect or boolean or number or text",
      "required": true/false,
      "filterable": true/false,
      "options": ["Realistic", "Option", "Values"],
      "unit": "unit if applicable (e.g., GB, inches, kg)"
    }
  ],
  "typicalProducts": ["3-5", "real", "product", "examples"]
}

ATTRIBUTE GUIDELINES:
- Minimum 4 attributes, maximum 6
- Use "select" type for categorical choices (Brand, Condition, Size)
- Use "boolean" for yes/no features (Waterproof, Bluetooth)
- Use "number" for measurable values (Weight, Capacity)
- Use "text" for free-form input (Model Number)
- "required": true for essential filtering attributes
- "filterable": true for attributes users commonly filter by
- Each "select" type MUST have 3-8 realistic options
- Think about what matters for RENTAL decisions (condition, duration, maintenance)`;
  }

  prompt += `

RESPONSE RULES:
1. Return ONLY the JSON object, no other text
2. All field names must be exactly as shown
3. All string values must be descriptive and relevant to "${categoryName}"
4. Think about REAL rental scenarios and what customers need to know`;

  return prompt;
}

/**
 * Intelligent attribute processor - validates and enhances
 */
function processAttributes(attributes, categoryName = "") {
  if (!Array.isArray(attributes) || attributes.length === 0) {
    return generateDynamicAttributes(categoryName);
  }
  
  const validTypes = ['text', 'number', 'boolean', 'select', 'multiselect'];
  
  return attributes
    .slice(0, 6) // Max 6 attributes
    .map(attr => {
      const type = validTypes.includes(attr.type) ? attr.type : 'select';
      const processed = {
        name: attr.name || "Specification",
        type: type,
        required: attr.required === true,
        filterable: attr.filterable !== false, // Default true
        unit: attr.unit || "",
      };
      
      // Only add options for select/multiselect types
      if (['select', 'multiselect'].includes(type)) {
        processed.options = Array.isArray(attr.options) && attr.options.length > 0
          ? attr.options.slice(0, 10) // Max 10 options
          : generateDefaultOptions(attr.name, categoryName);
      }
      
      return processed;
    });
}

/**
 * Generate dynamic default options based on attribute name and category
 */
function generateDefaultOptions(attributeName, categoryName) {
  const name = attributeName.toLowerCase();
  const category = categoryName.toLowerCase();
  
  // Condition attribute - universal for rentals
  if (name.includes('condition') || name.includes('state') || name.includes('quality')) {
    return ["Brand New", "Like New", "Excellent", "Very Good", "Good", "Fair"];
  }
  
  // Brand attribute
  if (name.includes('brand') || name.includes('manufacturer') || name.includes('make')) {
    return ["Premium Brands", "Mid-Range Brands", "Budget Brands", "Generic"];
  }
  
  // Size attribute
  if (name.includes('size') || name.includes('dimension')) {
    if (category.includes('furniture') || category.includes('bed') || category.includes('sofa')) {
      return ["Small", "Medium", "Large", "Extra Large", "Custom"];
    }
    return ["S", "M", "L", "XL", "XXL"];
  }
  
  // Material attribute
  if (name.includes('material') || name.includes('fabric') || name.includes('build')) {
    if (category.includes('furniture')) {
      return ["Wood", "Metal", "Glass", "Plastic", "Fabric", "Leather", "Mixed"];
    }
    return ["Premium Material", "Standard Material", "Eco-Friendly Material", "Synthetic", "Natural"];
  }
  
  // Color attribute
  if (name.includes('color') || name.includes('colour') || name.includes('finish')) {
    return ["Black", "White", "Grey", "Blue", "Red", "Green", "Brown", "Custom"];
  }
  
  // Duration/Rental period
  if (name.includes('duration') || name.includes('period') || name.includes('rental')) {
    return ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly"];
  }
  
  // Capacity
  if (name.includes('capacity') || name.includes('volume') || name.includes('storage')) {
    return ["Small", "Medium", "Large", "Extra Large"];
  }
  
  // Power/Energy
  if (name.includes('power') || name.includes('energy') || name.includes('watt')) {
    return ["Low Power", "Medium Power", "High Power", "Energy Efficient", "Heavy Duty"];
  }
  
  // Warranty
  if (name.includes('warranty') || name.includes('guarantee') || name.includes('coverage')) {
    return ["No Warranty", "1 Month", "3 Months", "6 Months", "1 Year", "2 Years"];
  }
  
  // Generic fallback options
  return ["Basic", "Standard", "Premium", "Professional", "Enterprise"];
}

/**
 * Generate dynamic attributes based on category analysis
 */
function generateDynamicAttributes(categoryName) {
  const name = categoryName.toLowerCase();
  const attributes = [];
  
  // Universal rental attributes
  attributes.push({
    name: "Condition",
    type: "select",
    required: true,
    filterable: true,
    options: ["Brand New", "Like New", "Excellent", "Very Good", "Good", "Fair"]
  });
  
  attributes.push({
    name: "Rental Duration",
    type: "select",
    required: true,
    filterable: true,
    options: ["Daily", "Weekly", "Bi-weekly", "Monthly", "Quarterly"]
  });
  
  // Category-specific attributes
  if (name.includes('furniture') || name.includes('sofa') || name.includes('chair') || 
      name.includes('table') || name.includes('bed') || name.includes('mattress') ||
      name.includes('wardrobe') || name.includes('shelf') || name.includes('desk')) {
    attributes.push(
      { name: "Material", type: "select", required: true, filterable: true, 
        options: ["Wood", "Metal", "Glass", "Plastic", "Fabric", "Leather", "Engineered Wood", "Rattan"] },
      { name: "Color", type: "select", required: false, filterable: true, 
        options: ["Black", "White", "Brown", "Grey", "Blue", "Beige", "Walnut", "Oak"] },
      { name: "Assembly Required", type: "boolean", required: false, filterable: true }
    );
  } else if (name.includes('electronic') || name.includes('laptop') || name.includes('computer') ||
             name.includes('mobile') || name.includes('phone') || name.includes('tablet') ||
             name.includes('tv') || name.includes('television') || name.includes('monitor')) {
    attributes.push(
      { name: "Brand", type: "select", required: true, filterable: true, 
        options: ["Apple", "Samsung", "Dell", "HP", "Lenovo", "Asus", "Sony", "LG", "Google", "OnePlus"] },
      { name: "Warranty", type: "select", required: false, filterable: true, 
        options: ["No Warranty", "3 Months", "6 Months", "1 Year", "2 Years"] },
      { name: "Accessories Included", type: "multiselect", required: false, filterable: true,
        options: ["Charger", "Cable", "Case", "Stand", "Manual", "Original Box"] }
    );
  } else if (name.includes('appliance') || name.includes('refrigerator') || name.includes('fridge') ||
             name.includes('washing') || name.includes('dryer') || name.includes('dishwasher') ||
             name.includes('microwave') || name.includes('oven') || name.includes('ac') || 
             name.includes('air condition') || name.includes('cooler') || name.includes('heater')) {
    attributes.push(
      { name: "Energy Rating", type: "select", required: false, filterable: true, 
        options: ["5 Star", "4 Star", "3 Star", "2 Star", "1 Star", "Not Rated"] },
      { name: "Brand", type: "select", required: true, filterable: true, 
        options: ["Samsung", "LG", "Whirlpool", "Godrej", "Voltas", "Panasonic", "Haier", "Bosch", "IFB"] },
      { name: "Installation Required", type: "boolean", required: false, filterable: true }
    );
  } else if (name.includes('vehicle') || name.includes('car') || name.includes('bike') || 
             name.includes('bicycle') || name.includes('scooter') || name.includes('motorcycle')) {
    attributes.push(
      { name: "Fuel Type", type: "select", required: false, filterable: true, 
        options: ["Petrol", "Diesel", "Electric", "Hybrid", "CNG"] },
      { name: "Transmission", type: "select", required: false, filterable: true, 
        options: ["Automatic", "Manual"] },
      { name: "Insurance Included", type: "boolean", required: false, filterable: true }
    );
  } else if (name.includes('camera') || name.includes('photography') || name.includes('video') ||
             name.includes('lens') || name.includes('dslr') || name.includes('mirrorless')) {
    attributes.push(
      { name: "Brand", type: "select", required: true, filterable: true, 
        options: ["Canon", "Nikon", "Sony", "Fujifilm", "Panasonic", "Olympus"] },
      { name: "Sensor Type", type: "select", required: false, filterable: true, 
        options: ["Full Frame", "APS-C", "Micro Four Thirds", "Medium Format"] },
      { name: "Lens Included", type: "boolean", required: false, filterable: true }
    );
  } else if (name.includes('tool') || name.includes('drill') || name.includes('saw') || 
             name.includes('hammer') || name.includes('equipment') || name.includes('machinery')) {
    attributes.push(
      { name: "Power Source", type: "select", required: false, filterable: true, 
        options: ["Electric", "Battery", "Petrol", "Pneumatic", "Manual"] },
      { name: "Brand", type: "select", required: true, filterable: true, 
        options: ["Bosch", "DeWalt", "Makita", "Stanley", "Black+Decker", "Milwaukee"] },
      { name: "Safety Gear Included", type: "boolean", required: false, filterable: true }
    );
  } else if (name.includes('sport') || name.includes('fitness') || name.includes('exercise') ||
             name.includes('gym') || name.includes('yoga') || name.includes('workout')) {
    attributes.push(
      { name: "Difficulty Level", type: "select", required: false, filterable: true, 
        options: ["Beginner", "Intermediate", "Advanced", "Professional"] },
      { name: "Portable", type: "boolean", required: false, filterable: true },
      { name: "Weight", type: "number", required: false, filterable: true, unit: "kg" }
    );
  } else if (name.includes('book') || name.includes('novel') || name.includes('textbook') ||
             name.includes('magazine') || name.includes('comic') || name.includes('publication')) {
    attributes.push(
      { name: "Genre", type: "multiselect", required: false, filterable: true, 
        options: ["Fiction", "Non-Fiction", "Science", "Technology", "Business", "History", "Self-Help", "Biography"] },
      { name: "Format", type: "select", required: false, filterable: true, 
        options: ["Hardcover", "Paperback", "E-Book", "Audiobook"] },
      { name: "Language", type: "select", required: false, filterable: true, 
        options: ["English", "Hindi", "Spanish", "French", "German", "Chinese", "Arabic"] }
    );
  } else {
    // Generic attributes for any other category
    attributes.push(
      { name: "Brand", type: "select", required: false, filterable: true, 
        options: ["Premium", "Standard", "Budget", "Generic"] },
      { name: "Size/Dimensions", type: "select", required: false, filterable: true, 
        options: ["Small", "Medium", "Large", "Extra Large"] },
      { name: "Includes Accessories", type: "boolean", required: false, filterable: true }
    );
  }
  
  // Ensure we return 4-6 attributes
  return attributes.slice(0, 6);
}

/**
 * Parse AI response with dynamic validation
 */
function parseAICategoryResponse(response, categoryName, level = 0) {
  try {
    console.log(`📝 Parsing AI response for "${categoryName}" at level ${level}...`);
    
    const cleanedJson = extractJSONFromResponse(response);
    if (!cleanedJson) {
      console.warn("⚠️ JSON extraction failed, generating dynamic fallback");
      return generateDynamicFallback(categoryName, level);
    }
    
    let parsed;
    try {
      parsed = JSON.parse(cleanedJson);
      console.log("✅ JSON parsed successfully");
      console.log("📊 Response keys:", Object.keys(parsed));
    } catch (e) {
      console.error("JSON parse error:", e.message);
      return generateDynamicFallback(categoryName, level);
    }
    
    if (!parsed.mainCategory) {
      console.warn("⚠️ Missing mainCategory in response");
      return generateDynamicFallback(categoryName, level);
    }
    
    const isLeafLevel = level >= 2;
    
    // Build validated data structure
    let validatedData = {
      mainCategory: {
        name: parsed.mainCategory.name || categoryName,
        description: parsed.mainCategory.description || generateDynamicDescription(categoryName),
        iconSuggestion: parsed.mainCategory.iconSuggestion || getDynamicIcon(categoryName),
        colorScheme: validateColorScheme(parsed.mainCategory.colorScheme, categoryName),
        keywords: validateKeywords(parsed.mainCategory.keywords, categoryName),
      },
      generatedAt: new Date().toISOString(),
      level: level,
      isLeaf: isLeafLevel
    };
    
    if (isLeafLevel) {
      // LEAF LEVEL: Must have attributes, NO subcategories
      const attributes = parsed.attributes || [];
      
      if (attributes.length === 0) {
        console.warn(`⚠️ AI returned no attributes for leaf category "${categoryName}", generating dynamically`);
        validatedData.attributes = generateDynamicAttributes(categoryName);
      } else {
        validatedData.attributes = processAttributes(attributes, categoryName);
      }
      
      validatedData.typicalProducts = Array.isArray(parsed.typicalProducts) && parsed.typicalProducts.length > 0
        ? parsed.typicalProducts.slice(0, 8)
        : generateTypicalProducts(categoryName);
        
      validatedData.subCategories = []; // Explicitly empty
      
      console.log(`🍃 Leaf category with ${validatedData.attributes.length} attributes`);
    } else {
      // PARENT LEVEL: Can have subcategories, NO attributes
      const subCategories = parsed.subCategories || [];
      
      if (subCategories.length === 0) {
        console.warn(`⚠️ AI returned no subcategories for parent category "${categoryName}"`);
        validatedData.subCategories = generateDynamicSubcategories(categoryName, level);
      } else {
        validatedData.subCategories = processSubcategories(subCategories, categoryName, level + 1);
      }
      
      validatedData.attributes = []; // Explicitly empty for parent levels
      
      console.log(`📁 Parent category with ${validatedData.subCategories.length} subcategories`);
    }
    
    return { success: true, data: validatedData };
  } catch (error) {
    console.error("❌ Error parsing AI response:", error.message);
    return generateDynamicFallback(categoryName, level);
  }
}

/**
 * Generate dynamic description based on category name
 */
function generateDynamicDescription(categoryName) {
  const templates = [
    `Browse our collection of ${categoryName.toLowerCase()} available for rent. Perfect for short-term needs, events, or trying before buying.`,
    `Find the perfect ${categoryName.toLowerCase()} for your needs. Flexible rental periods with delivery and setup options available.`,
    `Quality ${categoryName.toLowerCase()} rentals for personal and business use. Competitive rates with hassle-free booking and returns.`,
    `Explore our wide range of ${categoryName.toLowerCase()} for rent. Whether you need it for a day or a month, we have flexible options.`
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * Dynamic icon selector based on category name
 */
function getDynamicIcon(categoryName) {
  const iconMap = {
    // Furniture
    furniture: "🪑", sofa: "🛋️", couch: "🛋️", chair: "💺", table: "🍽️", desk: "🖥️",
    bed: "🛏️", mattress: "🛏️", wardrobe: "👔", shelf: "📚", cabinet: "🗄️", drawer: "🗄️",
    stool: "🪑", bench: "🪑", recliner: "💺", futon: "🛋️", ottoman: "🪑",
    
    // Electronics
    electronics: "⚡", gadget: "📱", mobile: "📱", phone: "📱", smartphone: "📱",
    laptop: "💻", computer: "🖥️", pc: "🖥️", desktop: "🖥️", tablet: "📱",
    tv: "📺", television: "📺", monitor: "🖥️", screen: "🖥️", display: "🖥️",
    speaker: "🔊", audio: "🎧", headphone: "🎧", earphone: "🎧", sound: "🔊",
    console: "🎮", gaming: "🎮", playstation: "🎮", xbox: "🎮", nintendo: "🎮",
    drone: "🛸", camera: "📸", gopro: "📸",
    
    // Appliances
    appliance: "🔌", refrigerator: "❄️", fridge: "❄️", freezer: "❄️",
    washing: "🧺", laundry: "🧺", dryer: "👕", dishwasher: "🍽️",
    microwave: "📡", oven: "🍳", stove: "🍳", cooktop: "🍳",
    ac: "❄️", air: "💨", cooler: "💨", heater: "🔥", fan: "🌀",
    vacuum: "🧹", cleaner: "🧹",
    
    // Kitchen
    kitchen: "🍳", cooking: "👨‍🍳", blender: "🥤", mixer: "🎛️", toaster: "🍞",
    coffee: "☕", espresso: "☕", kettle: "🫖", juicer: "🧃",
    utensil: "🥄", cookware: "🍲", bakeware: "🎂",
    
    // Fashion
    clothing: "👔", fashion: "👗", dress: "👗", shirt: "👔", pants: "👖",
    shoe: "👟", sneaker: "👟", boot: "👢", sandal: "👡",
    jewelry: "💍", accessory: "👜", bag: "👜", watch: "⌚",
    
    // Sports & Fitness
    sports: "⚽", fitness: "💪", exercise: "🏋️", gym: "🏋️", yoga: "🧘",
    bicycle: "🚲", bike: "🏍️", cycle: "🚲", motorcycle: "🏍️",
    treadmill: "🏃", dumbbell: "🏋️", weight: "🏋️",
    cricket: "🏏", football: "🏈", basketball: "🏀", tennis: "🎾",
    
    // Books & Media
    book: "📚", novel: "📖", textbook: "📗", magazine: "📰",
    comic: "💭", manga: "📘", dvd: "💿", bluray: "💿",
    
    // Tools & Equipment
    tool: "🔧", drill: "🔩", saw: "🪚", hammer: "🔨", wrench: "🔧",
    equipment: "⚙️", machinery: "🏗️", hardware: "🔩",
    
    // Garden & Outdoor
    garden: "🌱", plant: "🌿", outdoor: "🏕️", camping: "⛺", tent: "⛺",
    grill: "🔥", barbecue: "🍖", patio: "🏡",
    
    // Baby & Kids
    baby: "👶", kid: "🧒", child: "👧", toy: "🧸", stroller: "🦽",
    crib: "👶", carseat: "💺",
    
    // Automotive
    car: "🚗", vehicle: "🚙", automotive: "🔧", truck: "🚛", van: "🚐",
    
    // Medical
    medical: "🏥", health: "❤️", wheelchair: "🦽", crutch: "🩼",
    monitor: "📊", bp: "🩺", oxygen: "🫁",
    
    // Office
    office: "🏢", printer: "🖨️", scanner: "📠", projector: "📽️",
    stationery: "📎", paper: "📄",
    
    // Musical Instruments
    music: "🎵", instrument: "🎸", guitar: "🎸", piano: "🎹", keyboard: "🎹",
    drum: "🥁", violin: "🎻", flute: "🎵",
    
    // Party & Events
    party: "🎉", event: "🎊", wedding: "💒", decoration: "🎀",
    lighting: "💡", sound: "🔊",
  };
  
  const lowerName = categoryName.toLowerCase();
  
  // Try exact match first
  if (iconMap[lowerName]) return iconMap[lowerName];
  
  // Try partial match
  for (const [key, icon] of Object.entries(iconMap)) {
    if (lowerName.includes(key)) return icon;
  }
  
  // Default fallback
  return "📦";
}

/**
 * Validate and fix color scheme
 */
function validateColorScheme(color, categoryName) {
  if (color && /^#[0-9A-Fa-f]{6}$/.test(color)) {
    return color;
  }
  
  // Generate based on category
  const hash = categoryName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 50%)`;
}

/**
 * Validate keywords
 */
function validateKeywords(keywords, categoryName) {
  if (Array.isArray(keywords) && keywords.length > 0) {
    return keywords
      .filter(k => typeof k === 'string' && k.length > 0)
      .slice(0, 10)
      .map(k => k.toLowerCase().trim());
  }
  
  // Generate keywords from category name
  const words = categoryName.toLowerCase().split(/\s+/);
  return [
    ...words,
    'rental',
    'rent',
    'lease',
    'hire',
    'online',
    'delivery'
  ].slice(0, 8);
}

/**
 * Process subcategories recursively with attribute enforcement at leaf level
 */
function processSubcategories(subCategories, parentCategoryName, currentLevel) {
  if (!Array.isArray(subCategories) || subCategories.length === 0) {
    return [];
  }
  
  return subCategories.slice(0, 8).map(sub => {
    const hasChildren = sub.hasChildren === true || 
                        (Array.isArray(sub.children) && sub.children.length > 0);
    const isLeafLevel = currentLevel >= 2 || !hasChildren;
    
    const processed = {
      name: sub.name || `${parentCategoryName} Subcategory`,
      description: sub.description || generateDynamicDescription(sub.name || parentCategoryName),
      hasChildren: !isLeafLevel && hasChildren,
      iconSuggestion: sub.iconSuggestion || getDynamicIcon(sub.name || ""),
      colorScheme: validateColorScheme(sub.colorScheme, sub.name || ""),
      level: currentLevel,
      isLeaf: isLeafLevel
    };
    
    if (isLeafLevel) {
      // LEAF: Must have attributes, no children
      const attributes = sub.attributes || [];
      processed.attributes = attributes.length > 0 
        ? processAttributes(attributes, sub.name || parentCategoryName)
        : generateDynamicAttributes(sub.name || parentCategoryName);
      processed.children = [];
      processed.typicalProducts = Array.isArray(sub.typicalProducts) && sub.typicalProducts.length > 0
        ? sub.typicalProducts.slice(0, 5)
        : generateTypicalProducts(sub.name || parentCategoryName);
    } else {
      // PARENT: No attributes, may have children
      processed.attributes = [];
      processed.children = hasChildren && Array.isArray(sub.children)
        ? processSubcategories(sub.children, sub.name, currentLevel + 1)
        : generateDynamicSubcategories(sub.name || parentCategoryName, currentLevel);
      processed.typicalProducts = [];
    }
    
    return processed;
  });
}

/**
 * Generate typical products dynamically
 */
function generateTypicalProducts(categoryName) {
  const name = categoryName.toLowerCase();
  
  // Electronics
  if (name.includes('phone') || name.includes('mobile') || name.includes('smartphone')) {
    return ["iPhone 15 Pro", "Samsung Galaxy S24", "Google Pixel 8", "OnePlus 12", "Xiaomi 14"];
  }
  if (name.includes('laptop') || name.includes('notebook')) {
    return ["MacBook Pro 16", "Dell XPS 15", "ThinkPad X1 Carbon", "HP Spectre x360", "ASUS ROG Zephyrus"];
  }
  if (name.includes('tablet') || name.includes('ipad')) {
    return ["iPad Pro", "Samsung Galaxy Tab S9", "iPad Air", "Microsoft Surface Pro", "Amazon Fire HD"];
  }
  if (name.includes('tv') || name.includes('television')) {
    return ["Samsung 65\" QLED 4K TV", "LG 55\" OLED TV", "Sony 75\" Bravia XR", "TCL 50\" 4K TV"];
  }
  
  // Furniture
  if (name.includes('sofa') || name.includes('couch')) {
    return ["3-Seater Fabric Sofa", "L-Shape Sectional Sofa", "Recliner Sofa", "Sleeper Sofa", "Chesterfield Sofa"];
  }
  if (name.includes('bed')) {
    return ["Queen Size Bed", "King Size Bed", "Single Bed", "Bunk Bed", "Murphy Bed"];
  }
  if (name.includes('table') || name.includes('desk')) {
    return ["6-Seater Dining Table", "Standing Desk", "Coffee Table", "Study Table", "Folding Table"];
  }
  if (name.includes('chair')) {
    return ["Ergonomic Office Chair", "Dining Chair Set", "Accent Chair", "Rocking Chair", "Bean Bag"];
  }
  
  // Appliances
  if (name.includes('refrigerator') || name.includes('fridge')) {
    return ["Samsung 260L Frost Free", "LG 240L Double Door", "Whirlpool 190L Single Door", "Godrej 310L Side by Side"];
  }
  if (name.includes('washing') || name.includes('laundry')) {
    return ["LG 7kg Front Load", "Samsung 6.5kg Top Load", "IFB 8kg Fully Automatic", "Bosch 9kg Washer Dryer"];
  }
  if (name.includes('ac') || name.includes('air condition')) {
    return ["Daikin 1.5 Ton Inverter", "Voltas 1 Ton Split AC", "LG 2 Ton Window AC", "Blue Star 1.5 Ton Portable"];
  }
  if (name.includes('microwave') || name.includes('oven')) {
    return ["Samsung 28L Convection", "LG 20L Solo", "IFB 30L Grill", "Panasonic 25L Microwave"];
  }
  
  // Generic
  return [
    `${categoryName} - Premium Model`,
    `${categoryName} - Standard Model`,
    `${categoryName} - Economy Model`,
    `${categoryName} - Professional Grade`,
    `${categoryName} - Compact Version`
  ];
}

/**
 * Generate dynamic subcategories based on category analysis
 */
function generateDynamicSubcategories(categoryName, currentLevel) {
  const name = categoryName.toLowerCase();
  const nextLevel = currentLevel + 1;
  const isNextLevelLeaf = nextLevel >= 2;
  
  let subcategories = [];
  
  if (name.includes('furniture')) {
    subcategories = [
      { name: "Living Room", hasChildren: true },
      { name: "Bedroom", hasChildren: true },
      { name: "Office Furniture", hasChildren: true },
      { name: "Outdoor Furniture", hasChildren: true }
    ];
  } else if (name.includes('electronics') || name.includes('electronic')) {
    subcategories = [
      { name: "Mobile Phones", hasChildren: !isNextLevelLeaf },
      { name: "Laptops", hasChildren: !isNextLevelLeaf },
      { name: "Tablets", hasChildren: !isNextLevelLeaf },
      { name: "Audio Devices", hasChildren: !isNextLevelLeaf }
    ];
  } else if (name.includes('appliances') || name.includes('appliance')) {
    subcategories = [
      { name: "Kitchen Appliances", hasChildren: !isNextLevelLeaf },
      { name: "Home Appliances", hasChildren: !isNextLevelLeaf },
      { name: "Cooling & Heating", hasChildren: !isNextLevelLeaf }
    ];
  } else {
    // Generic subcategories
    const prefixes = ["Premium", "Standard", "Professional", "Compact"];
    subcategories = prefixes.map(prefix => ({
      name: `${prefix} ${categoryName}`,
      hasChildren: !isNextLevelLeaf
    }));
  }
  
  return subcategories.map(sub => ({
    ...sub,
    description: generateDynamicDescription(sub.name),
    iconSuggestion: getDynamicIcon(sub.name),
    level: nextLevel,
    isLeaf: isNextLevelLeaf,
    attributes: isNextLevelLeaf ? generateDynamicAttributes(sub.name) : [],
    children: [],
    typicalProducts: isNextLevelLeaf ? generateTypicalProducts(sub.name) : []
  }));
}

/**
 * Generate complete dynamic fallback when AI fails
 */
function generateDynamicFallback(categoryName, level = 0) {
  console.log(`🔄 Generating dynamic fallback for "${categoryName}" at level ${level}`);
  
  const isLeafLevel = level >= 2;
  
  const data = {
    mainCategory: {
      name: categoryName,
      description: generateDynamicDescription(categoryName),
      iconSuggestion: getDynamicIcon(categoryName),
      colorScheme: validateColorScheme(null, categoryName),
      keywords: validateKeywords([], categoryName),
    },
    generatedAt: new Date().toISOString(),
    level: level,
    isLeaf: isLeafLevel
  };
  
  if (isLeafLevel) {
    data.attributes = generateDynamicAttributes(categoryName);
    data.typicalProducts = generateTypicalProducts(categoryName);
    data.subCategories = [];
  } else {
    data.subCategories = generateDynamicSubcategories(categoryName, level);
    data.attributes = [];
  }
  
  return { success: true, data };
}

// ==================== MAIN SERVICE FUNCTIONS ====================

/**
 * Generate category suggestions
 */
async function generateCategorySuggestions(categoryName, parentCategory = null, level = 0) {
  try {
    const cacheKey = `ai:category:v2:${categoryName.toLowerCase().trim()}:${parentCategory || "root"}:level${level}`;

    if (redisClient) {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          console.log("📦 Returning cached result");
          return JSON.parse(cached);
        }
      } catch (e) {
        console.warn("Redis get failed:", e.message);
      }
    }

    const prompt = buildCategoryPrompt(categoryName, parentCategory, level);
    
    let text;
    try {
      text = await generateWithMistral(prompt);
      console.log(`📥 AI response received (${text?.length || 0} chars)`);
    } catch (error) {
      console.error("Mistral AI request failed:", error.message);
      return generateDynamicFallback(categoryName, level);
    }

    const suggestions = parseAICategoryResponse(text, categoryName, level);

    if (redisClient && suggestions.success) {
      try {
        await redisClient.setex(cacheKey, cacheTTL, JSON.stringify(suggestions));
      } catch (e) {
        console.warn("Redis set failed:", e.message);
      }
    }

    return suggestions;
  } catch (error) {
    logger.error("Error generating category suggestions:", error.message);
    return generateDynamicFallback(categoryName, level);
  }
}

/**
 * Save AI-generated category with proper hierarchy
 */
async function saveCategoryFromAI(categoryData, userId, parentId = null, level = 0) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { mainCategory, attributes, subCategories, typicalProducts } = categoryData;
    if (!mainCategory?.name) throw new Error("Category name is required");

    const isLeafCategory = categoryData.isLeaf === true || 
                          (attributes && attributes.length > 0 && 
                           (!subCategories || subCategories.length === 0));
    
    console.log(`💾 Saving: "${mainCategory.name}" | Level: ${level} | Parent: ${parentId || 'root'} | Leaf: ${isLeafCategory}`);
    
    // Generate unique slug
    let slug = mainCategory.name.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    
    let existingCategory = await Category.findOne({ slug, parent: parentId }).session(session);
    let counter = 1;
    while (existingCategory) {
      slug = `${mainCategory.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${counter}`;
      existingCategory = await Category.findOne({ slug, parent: parentId }).session(session);
      counter++;
    }

    // Create main category with proper parent reference
    const newCategory = await Category.create([{
      name: mainCategory.name,
      description: mainCategory.description || generateDynamicDescription(mainCategory.name),
      slug: slug,
      parent: parentId || null,
      icon: mainCategory.iconSuggestion || getDynamicIcon(mainCategory.name),
      image: mainCategory.iconUrl ? { url: mainCategory.iconUrl } : {},
      attributes: isLeafCategory ? (attributes || generateDynamicAttributes(mainCategory.name)) : [],
      isActive: true,
      displayOrder: 0,
      level: level,
      ancestors: [], // Will be auto-populated by pre-save hook
      meta: {
        title: mainCategory.name,
        description: mainCategory.description || "",
        keywords: mainCategory.keywords || []
      },
      metadata: { 
        createdBy: userId, 
        aiGenerated: true, 
        generatedAt: new Date(),
        isLeafCategory: isLeafCategory,
        typicalProducts: isLeafCategory ? (typicalProducts || []) : []
      },
    }], { session });

    // Save subcategories if not leaf
    if (!isLeafCategory && subCategories && subCategories.length > 0) {
      console.log(`📁 Saving ${subCategories.length} subcategories for "${mainCategory.name}"`);
      await saveSubCategoriesRecursively(
        subCategories, 
        newCategory[0]._id, 
        userId, 
        session, 
        level + 1
      );
    }

    await session.commitTransaction();
    console.log(`✅ Category "${mainCategory.name}" saved successfully`);
    return newCategory[0];
  } catch (error) {
    await session.abortTransaction();
    logger.error("Error saving AI-generated category:", error);
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Recursively save subcategories with dynamic attribute handling
 */
async function saveSubCategoriesRecursively(subCategories, parentId, userId, session, currentLevel) {
  const maxDepth = 4; // Prevent infinite recursion
  
  for (const subCat of subCategories) {
    if (!subCat.name || currentLevel > maxDepth) continue;
    
    const isLeafLevel = subCat.isLeaf === true || 
                       currentLevel >= 2 || 
                       (!subCat.hasChildren && 
                        (!subCat.children || subCat.children.length === 0));
    
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
    
    // Create subcategory
    const newCategory = await Category.create([{
      name: subCat.name,
      description: subCat.description || generateDynamicDescription(subCat.name),
      slug: slug,
      parent: parentId,
      icon: subCat.iconSuggestion || getDynamicIcon(subCat.name),
      attributes: isLeafLevel 
        ? (subCat.attributes && subCat.attributes.length > 0 
            ? subCat.attributes 
            : generateDynamicAttributes(subCat.name))
        : [],
      isActive: true,
      level: currentLevel,
      meta: {
        title: subCat.name,
        description: subCat.description || "",
        keywords: subCat.keywords || []
      },
      metadata: { 
        createdBy: userId, 
        aiGenerated: true, 
        isLeafCategory: isLeafLevel,
        typicalProducts: isLeafLevel ? (subCat.typicalProducts || []) : []
      },
    }], { session });
    
    // Recursively save children if not leaf
    if (!isLeafLevel && subCat.children && subCat.children.length > 0) {
      await saveSubCategoriesRecursively(
        subCat.children, 
        newCategory[0]._id, 
        userId, 
        session, 
        currentLevel + 1
      );
    }
  }
}

/**
 * Generate category icon (placeholder - can be enhanced with actual AI image generation)
 */
async function generateCategoryIcon(categoryName, description = "") {
  const icon = getDynamicIcon(categoryName);
  return {
    success: true,
    url: `https://via.placeholder.com/200x200/3B82F6/FFFFFF?text=${encodeURIComponent(icon)}`,
    thumbnail: `https://via.placeholder.com/100x100/3B82F6/FFFFFF?text=${encodeURIComponent(icon)}`,
    metadata: { 
      category: categoryName, 
      generatedBy: "Emoji Mapper", 
      timestamp: new Date().toISOString() 
    },
  };
}

/**
 * Generate icon variations
 */
// async function generateIconVariations(categoryName, description = "", count = 4) {
//   const baseIcon = getDynamicIcon(categoryName);
//   const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
//   const variations = [];
  
//   for (let i = 0; i < Math.min(count, 6); i++) {
//     const color = colors[i].replace('#', '');
//     variations.push({
//       success: true,
//       url: `https://via.placeholder.com/200x200/${color}/FFFFFF?text=${encodeURIComponent(baseIcon)}`,
//       thumbnail: `https://via.placeholder.com/100x100/${color}/FFFFFF?text=${encodeURIComponent(baseIcon)}`,
//       color: colors[i],
//     });
//   }
  
//   return { success: true, variations, count: variations.length };
// }

// services/ai-category.service.js

/**
 * Generate icon variations using Mistral AI to create SVG icons
 */
async function generateIconVariations(categoryName, description = "", count = 4) {
  try {
    console.log(`🎨 Generating ${count} icon variations for: ${categoryName}`);
    
    const baseIcon = getDynamicIcon(categoryName);
    const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
    
    // Try to generate icons with Mistral AI (SVG format)
    try {
      const prompt = `Create a simple, modern SVG icon for "${categoryName}" category.
Description: ${description || `${categoryName} category`}
Style: Clean, minimalist, flat design, e-commerce style like Amazon/Flipkart category icons.

Generate an SVG icon with these EXACT specifications:
- 200x200 pixels viewBox
- Rounded rectangle background (rx="30")
- Simple, recognizable symbol representing ${categoryName}
- Modern gradient background
- White or light-colored foreground symbol
- No text in the icon
- Professional, premium look

Return ONLY valid SVG code wrapped in a JSON object like this:
{
  "svg": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>...</svg>"
}`;

      const response = await generateWithMistral(prompt);
      
      // Extract SVG from response
      let svgData = extractJSONFromResponse(response);
      
      if (svgData) {
        const parsed = JSON.parse(svgData);
        if (parsed.svg) {
          // Convert SVG to data URLs with different colors
          const variations = [];
          
          for (let i = 0; i < Math.min(count, colors.length); i++) {
            const coloredSvg = parsed.svg.replace(
              /<svg/,
              `<svg style="background-color: ${colors[i]}"`
            );
            
            const svgBase64 = Buffer.from(coloredSvg).toString('base64');
            const dataUrl = `data:image/svg+xml;base64,${svgBase64}`;
            
            variations.push({
              success: true,
              url: dataUrl,
              thumbnail: dataUrl,
              color: colors[i],
              svg: coloredSvg
            });
          }
          
          console.log(`✅ Generated ${variations.length} AI icons`);
          return { success: true, variations, count: variations.length };
        }
      }
    } catch (aiError) {
      console.warn('AI icon generation failed, using fallback:', aiError.message);
    }
    
    // Fallback: Generate colored emoji icons as data URLs
    console.log('🔄 Using emoji-based fallback icons');
    const variations = [];
    
    for (let i = 0; i < Math.min(count, colors.length); i++) {
      const dataUrl = await createEmojiIconDataUrl(baseIcon, colors[i]);
      
      variations.push({
        success: true,
        url: dataUrl,
        thumbnail: dataUrl,
        color: colors[i],
      });
    }
    
    return { success: true, variations, count: variations.length };
    
  } catch (error) {
    logger.error('Error generating icon variations:', error);
    // Ultimate fallback
    return generatePlaceholderIcons(categoryName, count);
  }
}

/**
 * Create a data URL with emoji on colored background
 */
async function createEmojiIconDataUrl(emoji, backgroundColor) {
  // Create an SVG with emoji and colored background
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" rx="30" fill="${backgroundColor}"/>
  <text x="100" y="115" text-anchor="middle" font-size="80" fill="white">${emoji}</text>
</svg>`;
  
  const svgBase64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${svgBase64}`;
}

/**
 * Generate placeholder icons (ultimate fallback)
 */
function generatePlaceholderIcons(categoryName, count = 4) {
  const emoji = getDynamicIcon(categoryName);
  const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
  const variations = [];
  
  for (let i = 0; i < Math.min(count, colors.length); i++) {
    // Create a simple colored square with emoji using CSS gradient
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <defs>
    <linearGradient id="grad${i}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors[i]};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${lightenColor(colors[i])};stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="200" height="200" rx="30" fill="url(#grad${i})"/>
  <text x="100" y="120" text-anchor="middle" font-size="80">${emoji}</text>
</svg>`;
    
    const svgBase64 = Buffer.from(svg).toString('base64');
    
    variations.push({
      success: true,
      url: `data:image/svg+xml;base64,${svgBase64}`,
      thumbnail: `data:image/svg+xml;base64,${svgBase64}`,
      color: colors[i],
    });
  }
  
  return { success: true, variations, count: variations.length };
}

/**
 * Lighten a hex color
 */
function lightenColor(hex, percent = 20) {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, (num >> 16) + amt);
  const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
  const B = Math.min(255, (num & 0x0000FF) + amt);
  return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
}

/**
 * Track category performance (stub implementation)
 */
async function trackCategoryPerformance(categoryId) {
  try {
    const category = await Category.findById(categoryId);
    if (!category) throw new Error('Category not found');
    
    const Product = mongoose.model('Product');
    const productCount = await Product.countDocuments({ category: categoryId, isActive: true });
    const rentedCount = await Product.countDocuments({ category: categoryId, 'status.isRented': true });
    
    return {
      category: category.name,
      totalProducts: productCount,
      rentedProducts: rentedCount,
      rentRate: productCount > 0 ? ((rentedCount / productCount) * 100).toFixed(2) : 0,
      level: category.level,
      isLeaf: category.level >= 2
    };
  } catch (error) {
    logger.error('Error tracking category performance:', error);
    return { totalProducts: 0, rentedProducts: 0, rentRate: 0 };
  }
}

/**
 * Get category trends (stub implementation)
 */
async function getCategoryTrends(categoryId) {
  return {
    trends: [],
    period: '30d',
    categoryId
  };
}

/**
 * Get category recommendations (stub implementation)
 */
async function getCategoryRecommendations(categoryId) {
  return {
    recommendations: [],
    basedOn: 'popularity',
    categoryId
  };
}

// Export all functions
module.exports = {
  generateCategorySuggestions,
  generateCategoryIcon,
  generateIconVariations,
  saveCategoryFromAI,
  getDynamicIcon,
  generateDynamicFallback,
  trackCategoryPerformance,
  getCategoryTrends,
  getCategoryRecommendations
};