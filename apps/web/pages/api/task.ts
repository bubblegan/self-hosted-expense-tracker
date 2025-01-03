import { NextApiRequest, NextApiResponse } from "next";
import { generateReadStatementPrompt } from "@/utils/ai/generate-read-statement-prompt";
import { nextAuthOptions } from "@/utils/auth/nextAuthOption";
import { completionToParsedData } from "@/utils/completion-to-parsed-data";
import { prisma } from "@/utils/prisma";
import { Request, Response } from "express";
import fs from "fs";
import multer from "multer";
import { getServerSession } from "next-auth";
import OpenAI from "openai";
import path from "path";
import { Readable } from "stream";
import { deleteTasks, fetchCompletedTasks, fetchTasks, uploadPdf } from "../../server/bg-task-route";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Set up multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "uploads");

    // Ensure the upload directory exists
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Extract file extension
    const ext = path.extname(file.originalname);
    // Append MIME type to the file name
    const mimePart = file.mimetype.replace("/", "-"); // Replace "/" in MIME types with "-"
    const baseName = path.basename(file.originalname, ext); // Remove extension from the base name

    cb(null, `${baseName}-${mimePart}${ext}`);
  },
});

const upload = multer({ storage });

async function getBody(req: NextApiRequest & Request) {
  const buf = await buffer(req);
  const rawBody = buf.toString("utf8");
  const keys = rawBody ? JSON.parse(rawBody) : {};
  return keys;
}

async function buffer(readable: Readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function handler(req: NextApiRequest & Request, res: NextApiResponse & Response) {
  const { method } = req;
  const session = await getServerSession(req, res, nextAuthOptions);
  if (!session?.user?.id) return;
  const userId = session?.user?.id;

  if (!userId) {
    res.status(401).end(`Not Authenticated`);
  }

  const categoryResult = await prisma.category.findMany({
    where: {
      userId: userId,
    },
  });

  switch (method) {
    case "GET":
      const fetchTasksResponse = await fetchTasks(userId);
      const tasksResult = await fetchTasksResponse.json();
      if (tasksResult) {
        res.status(200).json(tasksResult);
      } else {
        res.status(500).json({ error: "something went wrong" });
      }

      break;
    case "POST":
      const middleware = upload.single("statement");
      middleware(req, res, async () => {
        try {
          if (req.file?.mimetype === "application/zip") {
            const formData = new FormData();
            const buffer = fs.readFileSync(req.file?.path);
            const blob = new Blob([buffer]);

            formData.append("userId", userId.toString());
            formData.append("file", blob);
            formData.append("fileName", req.file.originalname);
            formData.append("category", JSON.stringify(categoryResult));

            const response = await uploadPdf(formData);

            if (response.ok) {
              res.status(200).json("success");
            } else {
              res.status(500).json("error");
            }
          }

          if (req.file?.mimetype === "application/pdf") {
            const assistant = await client.beta.assistants.create({
              name: "Financial Analyst Assistant",
              instructions:
                "You are expense reader. Use you knowledge to extract expenses from uploaded financial statement and categorise it.",
              model: "gpt-4o",
              tools: [{ type: "file_search" }],
              temperature: 0.1,
            });

            // A user wants to attach a file to a specific message, let's upload it.
            const pdfStatement = await client.files.create({
              file: fs.createReadStream(req.file?.path),
              purpose: "assistants",
            });

            const prompt = generateReadStatementPrompt(categoryResult);

            const thread = await client.beta.threads.create({
              messages: [
                {
                  role: "user",
                  content: prompt,
                  attachments: [{ file_id: pdfStatement.id, tools: [{ type: "file_search" }] }],
                },
              ],
            });

            const run = await client.beta.threads.runs.createAndPoll(thread.id, {
              assistant_id: assistant.id,
            });

            const messages = await client.beta.threads.messages.list(thread.id, {
              run_id: run.id,
            });

            if (messages.data[0].content[0].type === "text") {
              res.status(200).json({ result: messages.data[0].content[0].text.value });
            } else {
              res.status(500).json({ result: "No response" });
            }
          }
        } catch (error) {
          console.log(error);
        }
      });
      break;
    case "PATCH":
      const storeKeys = await getBody(req);
      const ids = storeKeys?.id?.map((id: string) => id) || [];
      const response = await fetchCompletedTasks(userId, ids);
      const tasks = await response.json();

      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        if (task) {
          const { completion, file, name } = task;
          if (file && completion) {
            const [parsedStatment, parsedExpenses] = completionToParsedData(completion, categoryResult);

            await prisma.statement.create({
              data: {
                name: name,
                date: parsedStatment.statementDate || new Date(),
                bank: parsedStatment.bank || "No",
                file: Buffer.from(file),
                userId: session?.user?.id,
                Expense: {
                  createMany: {
                    data: parsedExpenses
                      .filter((expense) => {
                        return !isNaN(expense.amount);
                      })
                      .map((expense) => {
                        return {
                          description: expense.description,
                          amount: expense.amount,
                          date: expense.date,
                          ...(expense.categoryId ? { categoryId: expense.categoryId } : {}),
                          userId,
                        };
                      }),
                  },
                },
              },
            });
          }
        }
      }
      await deleteTasks(userId, ids);
      res.status(200).end("success");
      break;
    case "DELETE":
      const deleteKeysObj = await getBody(req);
      const deleteKeys = deleteKeysObj?.id?.map((id: string) => id) || [];
      await deleteTasks(userId, deleteKeys);
      res.status(200).end("success");
      break;
    default:
      res.status(405).end(`Method ${method} Not Allowed`);
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default handler;
