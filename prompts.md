# Prompt
create a fullstack LLM chat app.

User uses microphone input to speak. The voice is streaming to the backend by websocket. After user stops speaking, the voice file is transcribed by whisper. The transcribed text is feed to OpenAI API compatibile LLM server (LM Studio). The response of LLM is sent back to the frontend app for displaying.

technique stacks:
1. frontend app: react, vite 7, typescript. cyberpunk visual style UI.
2. backend app: python, uv, transformer, openai whisper

# Copilot Command Line:
copilot --allow-all-urls --allow-all-tools --add-dir . --add-dir /tmp
