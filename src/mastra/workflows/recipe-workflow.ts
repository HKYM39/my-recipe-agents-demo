import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

// -------------------------------------------------------------
// Schema 定义：限定输入输出，确保上下游契约明确
// -------------------------------------------------------------
// 所需食材列表
const ingredientDetailsSchema = z.object({
  name: z.string(),
  category: z.string(),
  prep: z.string(),
  flavorRole: z.string(),
});

// 菜谱需要但提供列表中没有的食材
const missingItemSchema = z.object({
  item: z.string(),
  reason: z.string(),
  substitution: z.string().optional(),
});

// 菜谱食材
const ingredientPlanSchema = z.object({
  normalizedIngredients: z.array(ingredientDetailsSchema).default([]),
  missingItems: z.array(missingItemSchema).default([]),
  tasteDirection: z
    .object({
      requestedProfile: z.string().default(""),
      balanceNotes: z.array(z.string()).default([]),
      aromatics: z.array(z.string()).default([]),
    })
    .default({
      requestedProfile: "",
      balanceNotes: [],
      aromatics: [],
    }),
  servings: z.number().default(2),
  dietaryNotes: z.string().optional(),
});

// 菜谱
const recipeOutputSchema = z.object({
  recipeName: z.string(),
  servings: z.number(),
  overview: z.string(),
  ingredientList: z.array(
    z.object({
      item: z.string(),
      quantity: z.string(),
      prep: z.string().optional(),
      purpose: z.string().optional(),
    })
  ),
  steps: z.array(
    z.object({
      order: z.number(),
      instruction: z.string(),
      timing: z.string().optional(),
      tasteFocus: z.string().optional(),
    })
  ),
  finishingTouches: z.array(z.string()).default([]),
  tastingNotes: z.array(z.string()).default([]),
});

// 食材必要条件
const recipeRequestSchema = z.object({
  ingredients: z.array(z.string()).min(1, "至少提供一种食材"),
  taste: z.string().min(1, "请提供期望的口味"),
  servings: z.number().int().min(1).max(12).default(2),
  dietaryNotes: z.string().optional(),
});

// -------------------------------------------------------------
// Step: analyze-ingredients
// 调用 ingredientAgent 将用户输入转成结构化食材规划
// -------------------------------------------------------------
const analyzeIngredients = createStep({
  id: "analyze-ingredients",
  description: "整理食材、味型与限制，生成烹饪思路的原材料",
  inputSchema: recipeRequestSchema,
  outputSchema: ingredientPlanSchema,
  execute: async ({ inputData, mastra }) => {
    if (!inputData) {
      throw new Error("缺少食材输入");
    }

    const prompt = `
你将收到一组家庭厨房可用的食材信息与口味偏好，请输出严格 JSON（不要添加说明文字），结构如下：
{
  "normalizedIngredients": [
    { "name": "string", "category": "protein | vegetable | carb | condiment | garnish | other", "prep": "string", "flavorRole": "string" }
  ],
  "missingItems": [
    { "item": "string", "reason": "string", "substitution": "string" }
  ],
  "tasteDirection": {
    "requestedProfile": "string",
    "balanceNotes": ["string"],
    "aromatics": ["string"]
  },
  "servings": number,
  "dietaryNotes": "string"
}

规则：
- 如果用户未提供某些调味料，但为了达到口味有必要，请放在 missingItems，并注明替代方案
- prep 字段要指出具体处理方式（如“切丝”“冷水下锅焯30秒”）
- flavorRole 用简短文字描述该食材在味型中的作用
- 所有文本使用中文
- 仅返回 JSON

原始输入：
${JSON.stringify(inputData, null, 2)}
`;

    //const plan = await runAgentJson("ingredientAgent", prompt, mastra);
    // 调用大模型根据口味以及材料生成食材
    const agent = mastra?.getAgent("ingredientAgent");
    if (!agent) {
      throw new Error("食材LLM无法找到！");
    }
    const resp = await agent.generate([
      {
        role: "user",
        content: prompt,
      },
    ]);
    const plan = resp?.text.trim();
    if (!plan) {
      throw new Error("食材LLM返回空！");
    }

    const parsedPlan = ingredientPlanSchema.parse(parseJsonFromText(plan));

    return {
      ...parsedPlan,
      tasteDirection: {
        ...parsedPlan.tasteDirection,
        requestedProfile:
          parsedPlan.tasteDirection?.requestedProfile || inputData.taste,
        balanceNotes: parsedPlan.tasteDirection?.balanceNotes ?? [],
        aromatics: parsedPlan.tasteDirection?.aromatics ?? [],
      },
      servings: parsedPlan.servings ?? inputData.servings ?? 2,
      dietaryNotes: parsedPlan.dietaryNotes || inputData.dietaryNotes,
    };
  },
});

// -------------------------------------------------------------
// Step: craft-recipe
// 让 recipeAgent 依据规划输出可操作的菜谱
// -------------------------------------------------------------
const craftRecipe = createStep({
  id: "craft-recipe-agent",
  description: "将整理好的食材规划转化为详细菜谱",
  inputSchema: ingredientPlanSchema,
  outputSchema: recipeOutputSchema,
  execute: async ({ inputData, mastra }) => {
    if (!inputData) {
      throw new Error("缺少食材规划");
    }

    const prompt = `
你将得到一道菜的原料规划，请基于这些信息生成结构化 JSON（不要额外解释），必须符合：
{
  "recipeName": "string",
  "servings": number,
  "overview": "string",
  "ingredientList": [
    { "item": "string", "quantity": "string", "prep": "string", "purpose": "string" }
  ],
  "steps": [
    { "order": number, "instruction": "string", "timing": "string", "tasteFocus": "string" }
  ],
  "finishingTouches": ["string"],
  "tastingNotes": ["string"]
}

准则：
- steps 至少 5 步，覆盖准备、烹饪和收尾；timing 写具体分钟或火候
- 所有用量请给出具体单位（克、毫升、茶匙等），如未知可给“适量”并说明判断方法
- 在 overview 中概括口味与口感
- tastingNotes 解释最终味型如何对应用户需求
- 仅输出 JSON

食材规划：
${JSON.stringify(inputData, null, 2)}
`;

    //const recipe = await runAgentJson("recipeAgent", prompt, mastra);
    // 调用大模型根据食材，生成菜谱
    const agent = mastra?.getAgent("ingredientAgent");
    if (!agent) {
      throw new Error("食材LLM无法找到！");
    }
    const resp = await agent.generate([
      {
        role: "user",
        content: prompt,
      },
    ]);
    const recipe = resp?.text.trim();
    if (!recipe) {
      throw new Error("食材LLM返回空！");
    }

    const parsedRecipe = recipeOutputSchema.parse(parseJsonFromText(recipe));

    return {
      ...parsedRecipe,
      servings: parsedRecipe.servings || inputData.servings || 2,
    };
  },
});

// -------------------------------------------------------------
// Workflow 主体：按顺序执行两个步骤
// -------------------------------------------------------------
const recipeWorkflow = createWorkflow({
  id: "recipe-workflow",
  inputSchema: recipeRequestSchema,
  outputSchema: recipeOutputSchema,
})
  .then(analyzeIngredients)
  .then(craftRecipe)
  .commit();

export { recipeWorkflow };

// -------------------------------------------------------------
// parseJsonFromText：提取 LLM 输出中的 JSON 片段
// -------------------------------------------------------------
function parseJsonFromText(raw: string) {
  const cleaned = raw?.trim() ?? "";

  const jsonPayload = extractJsonCandidate(cleaned);

  try {
    return JSON.parse(jsonPayload);
  } catch (error) {
    throw new Error(
      `无法解析模型返回的 JSON：${(error as Error).message}\n原始内容：${raw}`
    );
  }
}

// -------------------------------------------------------------
// 处理LLM返回的JSON结果
// -------------------------------------------------------------
function extractJsonCandidate(text: string) {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return text.trim();
}
