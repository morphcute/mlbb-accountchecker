const express = require("express");
const path = require("path");
const validasi = require("./lib/validasi");
const countryList = require("./utils/data.json");

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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

// Start the server
app.listen(PORT, () => {
    console.log(`> Ready on http://localhost:${PORT}`);
});
