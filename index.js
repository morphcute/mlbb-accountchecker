const express = require("express");
const path = require("path");
const multer = require("multer");
const xlsx = require("xlsx");
const crypto = require("crypto");
const validasi = require("./lib/validasi");
const countryList = require("./utils/data.json");

const PORT = process.env.PORT || 3000;
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// In-memory job store (for demonstration purposes)
// In production, use Redis or a database
const jobs = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Cleanup old jobs every hour
setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs.entries()) {
        if (now - job.createdAt > 3600000) { // 1 hour
            jobs.delete(id);
        }
    }
}, 3600000);

app.get("/api/validasi", async (req, res) => {
    try {
        let { id, serverid } = req.query;
        if (id && serverid) {
            let response = await validasi(id, serverid);
            return res.json({
                status: "success",
                result: {
                    nickname: response['in-game-nickname']?.replace(/\+/g, " "),
                    country: countryList.find(a => a.countryShortCode == response.country)?.countryName || "Unknown"
                }
            });
        } else {
            return res.sendStatus(400);
        }
    } catch (e) {
        console.error(e)
        return res.status(500).json({
            status: "failed",
            message: e?.message || e || "Unknown Error"
        });
    }
});

app.post("/api/bulk-check", upload.single("file"), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ status: "failed", message: "No file uploaded" });
        }

        const jobId = crypto.randomUUID();
        const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        let rawData = xlsx.utils.sheet_to_json(sheet);

        // Filter out empty rows (where both UID and Server are missing)
        const data = rawData.filter(row => row["UID"] || row["Server"]);

        if (data.length === 0) {
            return res.status(400).json({ status: "failed", message: "No valid rows found in Excel file" });
        }

        // Initialize job
        jobs.set(jobId, {
            id: jobId,
            status: "processing",
            progress: 0,
            total: data.length,
            processed: 0,
            rows: [], // Store processed rows for frontend display
            result: null,
            error: null,
            createdAt: Date.now()
        });

        // Start processing in background
        processBulkData(jobId, data);

        res.json({ status: "success", jobId, message: "Processing started" });

    } catch (e) {
        console.error(e);
        return res.status(500).json({
            status: "failed",
            message: e?.message || e || "Unknown Error"
        });
    }
});

app.get("/api/job/:id", (req, res) => {
    const jobId = req.params.id;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ status: "failed", message: "Job not found" });
    }

    res.json({
        status: "success",
        data: {
            status: job.status,
            progress: job.progress,
            total: job.total,
            processed: job.processed,
            rows: job.rows, // Return processed rows
            error: job.error
        }
    });
});

app.get("/api/job/:id/download", (req, res) => {
    const jobId = req.params.id;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ status: "failed", message: "Job not found" });
    }

    if (job.status !== "completed" || !job.result) {
        return res.status(400).json({ status: "failed", message: "Job not completed yet" });
    }

    const buffer = job.result;
    res.setHeader("Content-Disposition", "attachment; filename=result.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
});

app.get("/api/template", (req, res) => {
    const data = [
        { "Players Name": "Example User", "Players IGN": "", "Server": "1234", "UID": "12345678" }
    ];
    const sheet = xlsx.utils.json_to_sheet(data);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, sheet, "Template");
    const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Disposition", "attachment; filename=template.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
});

async function processBulkData(jobId, data) {
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    try {
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const uid = row["UID"];
            const server = row["Server"];
            
            let status = "Error";
            let nickname = "";

            if (uid && server) {
                try {
                    const response = await validasi(uid, server);
                    nickname = response['in-game-nickname']?.replace(/\+/g, " ") || "Found (No Name)";
                    row["Players IGN"] = nickname;
                    row["Status"] = "Found";
                    status = "Found";
                } catch (e) {
                    nickname = "not found";
                    row["Players IGN"] = "not found";
                    row["Status"] = "Not Found";
                    status = "Not Found";
                }
            } else {
                row["Players IGN"] = "Invalid Data";
                row["Status"] = "Error";
                status = "Error";
            }

            // Update progress
            const job = jobs.get(jobId);
            if (job) {
                job.processed = i + 1;
                job.progress = Math.round(((i + 1) / data.length) * 100);
                // Add processed row to the job state
                job.rows.push({
                    id: i + 1,
                    server: server || "-",
                    uid: uid || "-",
                    username: nickname || "-",
                    status: status
                });
                jobs.set(jobId, job);
            } else {
                // Job cancelled or removed
                return;
            }

            // Add a small delay to be nice to the external API
            await delay(100); 
        }

        const newSheet = xlsx.utils.json_to_sheet(data);
        const newWorkbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(newWorkbook, newSheet, "Result");

        const buffer = xlsx.write(newWorkbook, { type: "buffer", bookType: "xlsx" });

        const job = jobs.get(jobId);
        if (job) {
            job.status = "completed";
            job.result = buffer;
            job.progress = 100;
            jobs.set(jobId, job);
        }

    } catch (error) {
        console.error("Job processing error:", error);
        const job = jobs.get(jobId);
        if (job) {
            job.status = "failed";
            job.error = error.message;
            jobs.set(jobId, job);
        }
    }
}

// Start the server
app.listen(PORT, () => {
    console.log(`> Ready on http://localhost:${PORT}`);
});
