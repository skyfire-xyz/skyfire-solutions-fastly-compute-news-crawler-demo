import { type Tool } from "ai"
import { z } from "zod"

export class BaseTool {
  public static readonly toolName: string = "base_tool"
  public static readonly instruction: string = ""

  constructor(protected config?: any) {
    this.config = config
  }

  public createTool(...args: any[]) {
    return this.createBaseTool(
      "Base tool description",
      z.object({}),
      async () => ({ success: true })
    )
  }

  public static ClientComponent: React.FC<any> = () => null

  protected createBaseTool(
    description: string,
    parameters: z.ZodType<any, any>,
    execute: (args: any) => Promise<any>
  ): Tool<any, any> {
    // The SDK's `tool()` helper is an identity function that exists only to
    // infer a tool's input type from its schema. BaseTool intentionally erases
    // that type, so the shape is annotated directly instead.
    return { description, inputSchema: parameters, execute } as unknown as Tool<
      any,
      any
    >
  }
}
