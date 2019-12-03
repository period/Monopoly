const app = require("express")();
const http = require("http").Server(app);
const fs = require("fs");
const io = require("socket.io")(http);

var games = {};

app.get("/", function(req, res) {
    res.header("Content-Type", "text/html");
    res.send(fs.readFileSync("index.html"));
})
app.get("/board", function(req, res) {
    res.header("Content-Type", "text/html");
    res.send(fs.readFileSync("board.html"));
})

app.get("/create-game", function(req, res) {
    res.header("Content-Type", "text/html");

})

io.on("connection", function(socket) {
    socket.on("join-room", function(data) {
        data = data.toString();
        if(games[data] == null) return socket.emit("eval", "window.location.href = \"./\"");
        socket.join(data);
        socket.emit("message", {type: "success", message: "Successfully joined game"});

    })
});

http.listen(1337, function() {
    console.log("WSS server started on 1337");
});