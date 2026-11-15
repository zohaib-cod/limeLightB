import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

export async function chatWithAssistant(userMessage, conversationHistory = [], catalogContext = {}) {
  const { products = [], routes = [], settings = {} } = catalogContext;

  const whatsapp = settings.whatsappNumber || '+92 345 7867016';

  // Construct summarized catalog for LLM context
  const productsSummary = products.slice(0, 12).map(p => 
    `- ${p.title} (${p.category || 'General'} | ${p.fabric || 'Premium'} | Rs. ${p.price}${p.originalPrice ? ` original Rs. ${p.originalPrice}` : ''} | SKU: ${p.sku || 'LIM-1'})`
  ).join('\n');

  const categoriesSummary = routes.map(r => r.name).join(', ');

  const systemPrompt = `You are the official Limelight AI Fashion & Personal Shopping Assistant.
Brand: Limelight Pakistan (Premier High-Street Fashion Brand).
Store Policy:
- Free Shipping across Pakistan on orders over Rs. 2,490.
- Cash On Delivery (COD) and Online Card Payment accepted nationwide.
- WhatsApp Helpline: ${whatsapp}
- 14-day hassle-free exchange policy.
- Standard Delivery: 2 to 4 working days.

Main Navigation Categories:
${categoriesSummary || 'NEW IN, WOMEN (Unstitched & Pret), MEN, GIRLS, SALE'}

Current Featured Products in Catalog:
${productsSummary}

Your Personality & Instructions:
1. Warm, elegant, courteous, and highly knowledgeable about Pakistani fashion, cuts, fabrics (velvet, karandi, khaddar, latha, jacquard), and occasions.
2. Language: Reply in the same language/script the user used (Roman Urdu, Urdu, or English). If they talk in Roman Urdu ("mjy wedding k liye suit chahye"), respond in warm, polite Roman Urdu!
3. Be helpful with recommendations: suggest specific dresses with prices from the catalog when asked.
4. Keep answers concise, clear, and nicely formatted with bullet points.
5. If customer asks to track order or talk to human agent, share the official WhatsApp (${whatsapp}) and tell them they can also click on the account icon to view their orders.
6. Never make up prices or policies that contradict the above.`;

  // Prepare messages array
  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  // Append recent history (up to last 6 messages)
  if (Array.isArray(conversationHistory)) {
    const recentHistory = conversationHistory.slice(-6);
    for (const msg of recentHistory) {
      if (msg && (msg.role === 'user' || msg.role === 'assistant') && msg.content) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  messages.push({ role: 'user', content: userMessage });

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature: 0.6,
        max_tokens: 600
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Groq API Error:', data);
      throw new Error(data.error?.message || 'AI assistant service temporarily unavailable');
    }

    const reply = data.choices?.[0]?.message?.content || "Assalam-o-Alaikum! How can I assist you with your shopping today?";

    // Find relevant products matching user query or reply
    const lowerQuery = (userMessage + ' ' + reply).toLowerCase();
    const matchedProducts = products.filter(p => {
      const titleMatch = p.title && lowerQuery.includes(p.title.toLowerCase().split(' ')[0]);
      const catMatch = p.category && lowerQuery.includes(p.category.toLowerCase());
      const fabMatch = p.fabric && lowerQuery.includes(p.fabric.toLowerCase().split(' ')[0]);
      return titleMatch || catMatch || fabMatch;
    }).slice(0, 3);

    return {
      reply,
      suggestedProducts: matchedProducts.map(p => ({
        id: p.id,
        title: p.title,
        price: p.price,
        originalPrice: p.originalPrice,
        image: p.image,
        category: p.category
      }))
    };
  } catch (err) {
    console.error('Assistant error:', err.message);
    throw err;
  }
}

