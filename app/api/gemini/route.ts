const GEMINI_MODEL = "gemini-3.1-flash-image-preview"; // Nano Banana 2
const GEMINI_PROMPT =
  "Make a hyper realistic professional product photography shot of this packaging";

export async function POST(request: Request) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: { message: "GOOGLE_AI_API_KEY not configured" } },
      { status: 500 }
    );
  }

  const body = (await request.json()) as { mimeType?: string; data?: string };
  if (!body?.data) {
    return Response.json(
      { error: { message: "Missing image data" } },
      { status: 400 }
    );
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: GEMINI_PROMPT },
              {
                inline_data: {
                  mime_type: body.mimeType ?? "image/png",
                  data: body.data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
        },
      }),
    }
  );

  const data = await res.json();
  return Response.json(data, { status: res.status });
}
