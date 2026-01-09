import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { getFilesFromDirectory, readFile } from "../utils/fileReader";
import { chunkText } from "../utils/chunker";
import { getOrCreateCollection } from "../vector/chroma";
import { getFileHash } from "../utils/fileHash";
import { FastifyBaseLogger } from "fastify";

interface IngestResult {
  filesIngested: number;
  filesSkipped: number;
  skippedReasons: Record<string, string>;
  chunksCreated: number;
  collectionName: string;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_CHUNKS_PER_FILE = 2000;
const BATCH_SIZE = 25; // Max chunks per batch for embedding

function logMemoryUsage(logger: FastifyBaseLogger, context: string) {
  const used = process.memoryUsage();
  logger.info(`[${context}] Memory: ${Math.round(used.heapUsed / 1024 / 1024)}MB / ${Math.round(used.heapTotal / 1024 / 1024)}MB`);
}

export async function ingestDocuments(logger: FastifyBaseLogger): Promise<IngestResult> {
  const dataDir = path.join(process.cwd(), "data", "documents");
  const collectionName = process.env.CHROMA_COLLECTION || "cew_docs_dev";
  
  let filesIngested = 0;
  let filesSkipped = 0;
  const skippedReasons: Record<string, string> = {};
  let totalChunks = 0;

  try {
    // Get all supported files
    const files = await getFilesFromDirectory(dataDir);
    
    if (files.length === 0) {
      logger.info("No documents found in the documents folder");
      return {
        filesIngested: 0,
        filesSkipped: 0,
        skippedReasons: {},
        chunksCreated: 0,
        collectionName,
      };
    }

    logger.info(`Found ${files.length} files to process`);
    logMemoryUsage(logger, "Start");

    // Get collection and existing hashes
    const collection = await getOrCreateCollection();
    const existingDocs = await collection.get();
    const existingHashes = new Set(
      existingDocs.metadatas
        ?.filter((m: any) => m?.file_hash)
        .map((m: any) => m.file_hash) || []
    );

    // Process files one at a time
    for (const filePath of files) {
      const fileName = path.basename(filePath);
      
      try {
        logger.info(`Starting ingestion for file: ${fileName}`);
        
        // Check file size first
        const stats = await fs.stat(filePath);
        if (stats.size > MAX_FILE_SIZE) {
          filesSkipped++;
          skippedReasons[fileName] = `File too large (${Math.round(stats.size / 1024 / 1024)}MB > 20MB)`;
          logger.warn(`Skipping ${fileName}: ${skippedReasons[fileName]}`);
          continue;
        }
        
        // Calculate file hash
        const fileHash = await getFileHash(filePath);
        
        // Skip if already ingested
        if (existingHashes.has(fileHash)) {
          logger.info(`Skipping already ingested file: ${fileName}`);
          filesSkipped++;
          skippedReasons[fileName] = "Already ingested";
          continue;
        }

        // Read file content
        const content = await readFile(filePath);
        const relativePath = path.relative(process.cwd(), filePath);
        
        // Handle single or multiple document contents (e.g., Excel sheets)
        const contents = Array.isArray(content) ? content : [content];
        
        let fileChunkCount = 0;
        
        for (const docContent of contents) {
          // Chunk the content
          const chunks = chunkText(docContent.text, 800, 150);
          
          if (chunks.length === 0) {
            continue;
          }
          
          // Check chunk limit
          if (chunks.length > MAX_CHUNKS_PER_FILE) {
            filesSkipped++;
            skippedReasons[fileName] = `Too many chunks (${chunks.length} > ${MAX_CHUNKS_PER_FILE})`;
            logger.warn(`Skipping ${fileName}: ${skippedReasons[fileName]}`);
            break;
          }

          // Process chunks in batches
          for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batchChunks = chunks.slice(i, i + BATCH_SIZE);
            
            // Prepare batch data
            const batchDocuments: string[] = [];
            const batchMetadatas: any[] = [];
            const batchIds: string[] = [];
            
            for (const chunk of batchChunks) {
              const chunkUuid = randomUUID();
              
              batchDocuments.push(chunk.text);
              batchMetadatas.push({
                doc_name: fileName,
                source_type: "local",
                local_path: relativePath,
                drive_link: null,
                page: null,
                section: docContent.metadata?.section || null,
                sheet: docContent.metadata?.sheet_name || null,
                chunk_id: chunkUuid,
                file_hash: fileHash,
              });
              batchIds.push(chunkUuid);
            }
            
            // Upsert batch to Chroma
            await collection.upsert({
              ids: batchIds,
              documents: batchDocuments,
              metadatas: batchMetadatas,
            });
            
            fileChunkCount += batchDocuments.length;
            
            // Clear batch arrays to free memory
            batchDocuments.length = 0;
            batchMetadatas.length = 0;
            batchIds.length = 0;
            
            // Log memory after each batch
            if ((i + BATCH_SIZE) % 100 === 0) {
              logMemoryUsage(logger, `Batch ${Math.floor(i / BATCH_SIZE) + 1}`);
            }
            
            // Allow garbage collection
            if (global.gc) {
              global.gc();
            }
          }
        }
        
        if (fileChunkCount > 0) {
          filesIngested++;
          totalChunks += fileChunkCount;
          logger.info(`Successfully ingested ${fileName} with ${fileChunkCount} chunks`);
        } else {
          filesSkipped++;
          skippedReasons[fileName] = "No content extracted";
          logger.warn(`No chunks created for file: ${fileName}`);
        }
        
        logMemoryUsage(logger, `After ${fileName}`);
        
      } catch (fileError) {
        // Catch errors for individual files
        filesSkipped++;
        const errorMessage = fileError instanceof Error ? fileError.message : String(fileError);
        skippedReasons[fileName] = errorMessage;
        logger.error(`Failed to process file ${fileName}: ${errorMessage}`);
        // Continue with next file
      }
    }

    logMemoryUsage(logger, "Complete");
    logger.info(`Ingestion complete: ${filesIngested} ingested, ${filesSkipped} skipped, ${totalChunks} chunks created`);

    return {
      filesIngested,
      filesSkipped,
      skippedReasons,
      chunksCreated: totalChunks,
      collectionName,
    };
  } catch (error) {
    // Catch any unexpected errors
    logger.error(`Unexpected error during ingestion: ${error}`);
    throw error;
  }
}
