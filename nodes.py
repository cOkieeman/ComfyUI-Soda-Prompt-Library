from comfy_api.latest import io


class SodaPromptLibrary(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="SodaPromptLibrary",
            display_name="Soda 提示词库",
            category="Soda/Prompt",
            description="看图选择本地角色、服饰和内容，展示组合后导入原生 Impact 编辑。组合快照随工作流保存。",
            inputs=[io.String.Input("text", default="", multiline=True, dynamic_prompts=False)],
            outputs=[io.String.Output("text", display_name="正文")],
        )

    @classmethod
    def execute(cls, text: str) -> io.NodeOutput:
        return io.NodeOutput(text)
