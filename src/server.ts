import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import archiver from "archiver";
import { Readable } from "stream";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const app = express();

app.use((req, res, next) => {
  res.setHeader("Connection", "close");
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../public")));
app.use(express.raw({ type: "application/octet-stream", limit: "100mb" }));

const s3Client = new S3Client({ region: "sa-east-1" });
const BUCKET_NAME = "aspira-cloud";


app.get("/api/url-upload", async (req: Request, res: Response) => {
  try {
    const fileName = req.query.nome_arquivo as string;

    const s3Key = `root/${fileName}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 300,
    });

    res.json({
      url: presignedUrl,
      caminhoFinal: s3Key,
    });
  } catch (error) {
    res.status(500).json({ erro: "Erro ao gerar URL" });
  }
});

app.get("/api/url-download", async (req: Request, res: Response) => {
  try {
    const fileName = req.query.nome_arquivo as string;
    if (!fileName) {
      return res.status(400).json({ erro: "Nome do arquivo eh obrigatorio" });
    }

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `root/${fileName}`,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 300,
    });

    res.json({ url: presignedUrl });
  } catch (error) {
    console.error("Erro ao gerar URL de download:", error);
    res.status(500).json({ erro: "Erro interno no servidor" });
  }
});

app.get("/api/listar", async (req: Request, res: Response) => {
  try {
    const prefix = (req.query.prefixo as string) || "root/";

    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      Delimiter: "/",
    });

    const respostaS3 = await s3Client.send(command);

    const pastas = (respostaS3.CommonPrefixes || []).map((p) => p.Prefix);

    const files = (respostaS3.Contents || [])
      .filter((arquivo) => arquivo.Key !== prefix)
      .map((arquivo) => ({
        chave: arquivo.Key,
        nome: arquivo.Key?.replace(prefix, ""),
        tamanho: arquivo.Size,
        dataModificacao: arquivo.LastModified,
      }));

    res.json({ pastas, arquivos: files, currentPrefix: prefix });
  } catch (error) {
    console.error("Erro ao listar arquivos:", error);
    res.status(500).json({ erro: "Erro ao listar do S3" });
  }
});

app.post(
  "/api/baixar-zip",
  async (req: Request, res: Response): Promise<any> => {
    try {
      const { chaves } = req.body;
      if (!chaves || !Array.isArray(chaves) || chaves.length === 0) {
        return res.status(400).send("Nenhum arquivo selecionado");
      }
      res.attachment(`AC_Files_${Date.now()}.zip`);

      const archive = archiver("zip", { zlib: { level: 5 } });

      archive.on("error", (err) => {
        throw err;
      });
      archive.pipe(res);

      for (const chave of chaves) {
        const command = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: chave,
        });
        const response = await s3Client.send(command);

        const stream = response.Body as Readable;

        const nomeArquivo = chave.split("/").pop() || chave;

        archive.append(stream, { name: nomeArquivo });
      }

      await archive.finalize();
    } catch (error) {
      console.error("Erro ao gerar ZIP:", error);
      if (!res.headersSent) res.status(500).send("Erro ao gerar ZIP");
    }
  },
);

app.delete("/api/excluir", async (req: Request, res: Response) => {
  try {
    const chaveArquivo = req.query.chave as string;

    if (!chaveArquivo) {
      return res.status(400).json({ erro: "Chave do arquivo é obrigatória" });
    }

    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: chaveArquivo,
    });

    await s3Client.send(command);

    res.json({ sucesso: true, mensagem: "Arquivo excluído com sucesso" });
  } catch (error) {
    console.error("Erro ao excluir arquivo:", error);
    res.status(500).json({ erro: "Erro interno ao tentar excluir do S3" });
  }
});

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
  console.log(`Aspira Server rodando na porta ${PORT}`);
});

server.requestTimeout = 300000;
server.headersTimeout = 305000;
server.keepAliveTimeout = 300000;
