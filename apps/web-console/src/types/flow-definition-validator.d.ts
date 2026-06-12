// Type surface for the SHARED flow semantic validator (change: add-console-flow-designer).
//
// The implementation lives in services/internal-contracts/src/flow-definition-validator.mjs
// (plain ESM + cel-js) and is the single rule set used by both the control-plane validate
// endpoint and this console. Only the exports the designer consumes are typed here.
declare module '@in-falcone/internal-contracts/src/flow-definition-validator.mjs' {
  export interface FlowValidatorError {
    code: string
    nodeId: string | null
    message: string
  }

  export interface FlowExpressionEngine {
    name?: string
    parse(expression: string): { ok: boolean }
  }

  export interface FlowValidatorOptions {
    expressionEngine?: FlowExpressionEngine
    resolveSubFlow?: (ref: { flowId: string; flowVersion: string }) => boolean
    taskTypeCatalog?: Iterable<string>
  }

  export const FLOW_VALIDATION_ERROR_CODES: Readonly<Record<string, string>>

  export const defaultExpressionEngine: FlowExpressionEngine

  export function validateFlowDefinition(
    definition: unknown,
    options?: FlowValidatorOptions
  ): { ok: boolean; errors: FlowValidatorError[] }
}
