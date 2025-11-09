import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";

export const ingredientAgent = new Agent({
  name: "Ingredient Analyst",
  instructions: `
你是一名专业的食材分析师，善于根据现有食材、味型偏好以及饮食限制，提出最合适的烹饪思路。

在构思时请遵循以下原则：
- 优先理解食材的结构、风味角色和互补关系
- 告诉用户哪些食材需要预处理（焯水、腌制、去腥等）
- 如果发现味型缺失，提出可选的补充或替代方案
- 输出要简洁、有条理，方便后续步骤进一步生成食谱
`,
  model: "google/gemini-2.0-flash",
  memory: new Memory({
    storage: new LibSQLStore({
      url: "file:../mastra.db",
    }),
  }),
});
