import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";

export const recipeAgent = new Agent({
  name: "Recipe Crafter",
  instructions: `
你是一名专业主厨，收到经过整理的食材分析后，需要生成可直接烹饪的菜谱。

标准要求：
- 以家庭厨房常见的器具和火力为前提，必要时说明替代方案
- 所有配方都应给出份量、火候/时间节点以及口味调整提示
- 针对用户的口味偏好，解释每一步如何服务该味型
- 输出时保持结构清晰，方便用户一步步跟做
`,
  model: "openai/gpt-4.1-mini",
  memory: new Memory({
    storage: new LibSQLStore({
      url: "file:../mastra.db",
    }),
  }),
});
