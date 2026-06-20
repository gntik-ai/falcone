# add-function-caller-context

Thread tamper-proof caller context (tenant/workspace/principal/roles/actorType) from the verified control-plane identity into Knative function invocations, surfaced to user code as a second context argument: main(params, context). Resolves GitHub issue #639.
