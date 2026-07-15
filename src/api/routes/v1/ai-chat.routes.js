// // // backend/routes/ai-chat.routes.js
// // const express = require('express')
// // const router = express.Router()
// // const { GoogleGenerativeAI } = require('@google/generative-ai')

// // const genAI = new GoogleGenerativeAI('AIzaSyDKo3MP7QqsSaODqtwt-ehMCXTiFDx4Uto')

// // router.post('/chat', async (req, res) => {
// //   const { message, context } = req.body
  
// //   try {
// //     const model = genAI.getGenerativeModel({ model: "gemini-pro" })
    
// //     const prompt = `You are RentEase customer support assistant. Help with: ${message}
// //     Previous conversation: ${JSON.stringify(context)}
// //     Be helpful, concise, and friendly.`
    
// //     const result = await model.generateContent(prompt)
// //     const reply = result.response.text()
    
// //     res.json({
// //       reply,
// //       suggestions: [
// //         "How to track my order?",
// //         "What's your return policy?",
// //         "Contact customer support"
// //       ]
// //     })
// //   } catch (error) {
// //     console.error('AI chat error:', error)
// //     res.status(500).json({ error: 'AI service unavailable' })
// //   }
// // })

// // module.exports = router




// // backend/routes/ai-chat.routes.js
// const express = require('express')
// const router = express.Router()
// const axios = require('axios')
// const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
// const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";


// // router.post('/chat', async (req, res) => {
// //   const { message, context } = req.body
  
// //   try {
// //     const chatResponse = await axios.post(
// //       MISTRAL_API_URL,
// //       {
// //         model: "mistral-small-latest",
// //         messages: [
// //           { 
// //             role: "system", 
// //             content: "You are RentEase customer support assistant. Be helpful, concise, and friendly."
// //           },
// //           { role: "user", content: `Previous conversation context: ${JSON.stringify(context)}\n\nCurrent question: ${message}` }
// //         ],
// //         temperature: 0.3,
// //         max_tokens: 4096,
// //       },
// //       {
// //         headers: {
// //           Authorization: `Bearer ${MISTRAL_API_KEY}`,
// //           "Content-Type": "application/json",
// //         },
// //         timeout: 60000,
// //       }
// //     );

// //     console.log("chatResponse-->>", chatResponse)
 
    
// //     const reply = chatResponse.choices[0].message.content
    
// //     res.json({
// //       reply,
// //       suggestions: [
// //         "How to track my order?",
// //         "What's your return policy?",
// //         "Contact customer support"
// //       ]
// //     })
// //   } catch (error) {
// //     console.error('Mistral AI chat error:', error)
// //     res.status(500).json({ error: 'AI service unavailable' })
// //   }
// // })

// router.post('/chat', async (req, res) => {
//   const { message, context } = req.body
  
//   // Validate input
//   if (!message) {
//     return res.status(400).json({ error: 'Message is required' })
//   }
  
//   try {
//     const chatResponse = await axios.post(
//       MISTRAL_API_URL,
//       {
//         model: "mistral-small-latest",
//         messages: [
//           { 
//             role: "system", 
//             content: "You are RentEase customer support assistant. Be helpful, concise, and friendly."
//           },
//           { 
//             role: "user", 
//             content: `Previous conversation context: ${JSON.stringify(context || [])}\n\nCurrent question: ${message}` 
//           }
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

//     // Validate response structure
//     if (!chatResponse.data?.choices?.[0]?.message?.content) {
//       throw new Error('Invalid response structure from Mistral API')
//     }
    
//     const reply = chatResponse.data.choices[0].message.content
    
//     res.json({
//       reply,
//       suggestions: [
//         "How to track my order?",
//         "What's your return policy?",
//         "Contact customer support"
//       ]
//     })
//   } catch (error) {
//     console.error('Mistral AI chat error:', error.message)
    
//     if (error.code === 'ECONNABORTED') {
//       res.status(504).json({ error: 'AI service timeout - please try again' })
//     } else if (error.response?.status === 401) {
//       res.status(500).json({ error: 'API authentication failed - check your API key' })
//     } else if (error.response?.status === 429) {
//       res.status(429).json({ error: 'Rate limit exceeded - please try again later' })
//     } else {
//       res.status(500).json({ error: 'AI service temporarily unavailable' })
//     }
//   }
// })

// module.exports = router



// backend/routes/ai-chat.routes.js
const express = require('express')
const router = express.Router()
const axios = require('axios')

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

// ─── Available Functions/Tools for the AI ─────────────────────────────────────
const AVAILABLE_TOOLS = [
  {
    type: "function",
    function: {
      name: "track_order",
      description: "Track an order using the order ID",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The unique order ID to track",
          },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_return_policy",
      description: "Get return policy information for a specific product or category",
      parameters: {
        type: "object",
        properties: {
          product_category: {
            type: "string",
            description: "The product category (electronics, furniture, clothing, etc.)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_product_availability",
      description: "Check if a product is available for rent",
      parameters: {
        type: "object",
        properties: {
          product_name: {
            type: "string",
            description: "Name of the product to check",
          },
          pincode: {
            type: "string",
            description: "Delivery pincode to check availability",
          },
        },
        required: ["product_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_rental_price",
      description: "Calculate rental price for a product",
      parameters: {
        type: "object",
        properties: {
          product_id: {
            type: "string",
            description: "Product ID",
          },
          duration_months: {
            type: "number",
            description: "Rental duration in months",
          },
        },
        required: ["product_id", "duration_months"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "contact_support",
      description: "Initiate contact with customer support",
      parameters: {
        type: "object",
        properties: {
          issue_type: {
            type: "string",
            description: "Type of issue",
            enum: ["order", "payment", "product", "delivery", "other"],
          },
          user_email: {
            type: "string",
            description: "User's email address",
          },
        },
        required: ["issue_type"],
      },
    },
  },
];

// ─── Function Implementations ─────────────────────────────────────────────────
async function trackOrder(orderId) {
  // This would call your actual order tracking API
  console.log(`Tracking order: ${orderId}`);
  
  // Mock implementation - replace with real API call
  try {
    // Example: const response = await axios.get(`${BASE_URL}/orders/${orderId}`);
    // Mock data
    const mockOrders = {
      "ORD123456": { status: "Delivered", date: "2024-05-15", items: ["Wireless Headphones"] },
      "ORD789012": { status: "In Transit", date: "2024-05-18", estimated_delivery: "2024-05-20", items: ["Smart Watch"] },
      "ORD345678": { status: "Processing", date: "2024-05-16", estimated_delivery: "2024-05-22", items: ["Laptop"] },
    };
    
    const order = mockOrders[orderId];
    if (order) {
      return `✅ Order ${orderId} is **${order.status}**!\n` +
             `📦 Items: ${order.items.join(", ")}\n` +
             (order.estimated_delivery ? `🚚 Expected delivery: ${order.estimated_delivery}\n` : "") +
             `📅 Order placed: ${order.date}`;
    } else {
      return `I couldn't find order ${orderId}. Please check your order ID or try again.`;
    }
  } catch (error) {
    console.error("Order tracking error:", error);
    return "Our order tracking system is temporarily unavailable. Please try again in a few moments.";
  }
}

async function checkProductAvailability(productName, pincode = null) {
  console.log(`Checking availability for: ${productName} at pincode: ${pincode || 'any'}`);
  
  // Mock implementation - replace with real API call
  const availableProducts = ["laptop", "headphones", "smartwatch", "camera", "projector"];
  const isAvailable = availableProducts.some(p => productName.toLowerCase().includes(p));
  
  if (isAvailable) {
    return `📦 Good news! **${productName}** is available for rent starting at just ₹199/month.\n` +
           (pincode ? `✅ Delivery to ${pincode} is available.` : "") +
           `\nWould you like to proceed with the rental?`;
  } else {
    return `I'm sorry, **${productName}** is currently out of stock. Would you like me to notify you when it becomes available?`;
  }
}

async function calculateRentalPrice(productId, durationMonths) {
  console.log(`Calculating price for product ${productId} for ${durationMonths} months`);
  
  // Mock implementation
  const productPrices = {
    "PROD001": { name: "Wireless Headphones", monthly: 199 },
    "PROD002": { name: "Smart Watch", monthly: 499 },
    "PROD003": { name: "Laptop", monthly: 999 },
  };
  
  const product = productPrices[productId];
  if (product) {
    const total = product.monthly * durationMonths;
    const discount = durationMonths >= 6 ? total * 0.1 : 0;
    const finalTotal = total - discount;
    
    return `💰 Price breakdown for **${product.name}**:\n` +
           `• Monthly: ₹${product.monthly}\n` +
           `• Duration: ${durationMonths} months\n` +
           `• Subtotal: ₹${total}\n` +
           (discount > 0 ? `• Discount (10% off for 6+ months): -₹${discount}\n` : "") +
           `• **Total: ₹${finalTotal}**\n` +
           `\nReady to rent this item?`;
  } else {
    return "I couldn't find that product. Could you please provide the product name or ID?";
  }
}

async function getReturnPolicy(productCategory = null) {
  const basePolicy = "🔄 Our return policy:\n" +
    "• 7-day return window for defective products\n" +
    "• 24-hour cancellation window for full refund\n" +
    "• Free pickup for damaged items\n" +
    "• Refund processed within 5-7 business days";
  
  if (productCategory) {
    const categoryRules = {
      electronics: "Electronics must be returned with original accessories and packaging.",
      furniture: "Furniture requires inspection before return approval.",
      clothing: "Clothing can be returned unworn with tags attached.",
    };
    return basePolicy + "\n\n" + (categoryRules[productCategory] || "Standard policy applies.");
  }
  
  return basePolicy;
}

async function contactSupport(issueType, userEmail = null) {
  let response = `📞 **Customer Support Initiated**\n` +
    `Issue Type: ${issueType}\n`;
  
  if (userEmail) {
    response += `Email: ${userEmail}\n`;
    response += `✅ A support ticket has been created. You'll receive a response within 24 hours.\n`;
  } else {
    response += `ℹ️ Please provide your email address so we can contact you.\n`;
  }
  
  response += `\nAlternatively, you can:\n` +
    `• Call us: 1800-123-4567\n` +
    `• Email: support@rentease.com\n` +
    `• Live chat: Available 9 AM - 9 PM`;
  
  return response;
}

// ─── Main Chat Handler with Function Calling ─────────────────────────────────
router.post('/chat', async (req, res) => {
  const { message, context, userId } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }
  
  try {
    // Prepare conversation history
    const conversationHistory = (context || []).slice(-10).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    }));
    
    let currentMessages = [
      {
        role: "system",
        content: `You are RentEase customer support assistant. You help users with:
- Tracking orders (requires order ID)
- Checking product availability
- Calculating rental prices
- Understanding return policies
- Contacting support

When users ask to track an order, ASK for the order ID first if not provided.
Be helpful, concise, and friendly. Use the available functions to get real data.`,
      },
      ...conversationHistory,
      {
        role: "user",
        content: message,
      },
    ];
    
    let shouldContinue = true;
    let maxIterations = 5;
    let finalResponse = null;
    let toolCallsUsed = [];
    
    while (shouldContinue && maxIterations-- > 0) {
      const response = await axios.post(
        MISTRAL_API_URL,
        {
          model: "mistral-small-latest",
          messages: currentMessages,
          tools: AVAILABLE_TOOLS,
          tool_choice: "auto",
          temperature: 0.3,
          max_tokens: 4096,
        },
        {
          headers: {
            Authorization: `Bearer ${MISTRAL_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        }
      );
      
      const assistantMessage = response.data.choices[0].message;
      currentMessages.push(assistantMessage);
      
      // Check if the AI wants to call a function
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);
          
          console.log(`AI calling function: ${functionName}`, functionArgs);
          toolCallsUsed.push({ name: functionName, args: functionArgs });
          
          let functionResult;
          
          // Execute the requested function
          switch (functionName) {
            case "track_order":
              functionResult = await trackOrder(functionArgs.order_id);
              break;
            case "check_product_availability":
              functionResult = await checkProductAvailability(
                functionArgs.product_name,
                functionArgs.pincode
              );
              break;
            case "calculate_rental_price":
              functionResult = await calculateRentalPrice(
                functionArgs.product_id,
                functionArgs.duration_months
              );
              break;
            case "get_return_policy":
              functionResult = await getReturnPolicy(functionArgs.product_category);
              break;
            case "contact_support":
              functionResult = await contactSupport(
                functionArgs.issue_type,
                functionArgs.user_email
              );
              break;
            default:
              functionResult = "This function is not yet implemented.";
          }
          
          // Add function result to conversation
          currentMessages.push({
            role: "tool",
            name: functionName,
            content: functionResult,
            tool_call_id: toolCall.id,
          });
        }
        
        shouldContinue = true; // Continue to let AI respond with the function results
        
      } else {
        // No function call, this is the final response
        finalResponse = assistantMessage.content;
        shouldContinue = false;
      }
    }
    
    // Generate suggestions based on context
    let suggestions = [
      "How to track my order?",
      "What's your return policy?",
      "Check product availability",
    ];
    
    // Customize suggestions based on what just happened
    if (toolCallsUsed.length > 0) {
      const lastTool = toolCallsUsed[toolCallsUsed.length - 1];
      if (lastTool.name === "track_order") {
        suggestions = [
          "Track another order",
          "Cancel my order",
          "Return my order",
        ];
      } else if (lastTool.name === "check_product_availability") {
        suggestions = [
          "Check another product",
          "How to rent?",
          "Pricing details",
        ];
      }
    }
    
    res.json({
      reply: finalResponse || "I'm here to help! What would you like to know?",
      suggestions: suggestions,
      toolCallsUsed: toolCallsUsed, // Optional: for debugging
    });
    
  } catch (error) {
    console.error('Mistral AI chat error:', error);
    
    if (error.response) {
      console.error('API Response error:', error.response.data);
      res.status(error.response.status).json({ 
        error: error.response.data.message || 'AI service error' 
      });
    } else if (error.request) {
      res.status(500).json({ error: 'AI service timeout - please try again' });
    } else {
      res.status(500).json({ error: 'AI service temporarily unavailable' });
    }
  }
});

module.exports = router;