export interface ResponsesContentPart {
  type?: string;
  text?: string;
  filename?: string;
  file_data?: string;
  file?: { filename?: string; file_data?: string };
  input_file?: { filename?: string; file_data?: string };
}

export interface ResponsesRequest {
  input?: Array<{
    role?: string;
    content?: string | ResponsesContentPart[];
  }>;
  text?: {
    format?: {
      type?: string;
      name?: string;
      strict?: boolean;
      schema?: Record<string, any>;
    };
  };
  background?: boolean;
  store?: boolean;
}

export function userInput(request: ResponsesRequest) {
  return request.input?.find((item) => item.role === 'user');
}

export function userInputText(request: ResponsesRequest): string {
  const content = userInput(request)?.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content)
    ? content
        .filter((part) => part.type === 'input_text')
        .map((part) => part.text ?? '')
        .join('\n')
    : '';
}

export function responsesCompleted(text: string, id = 'resp_e2e_fixture') {
  return {
    id,
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }]
  };
}
