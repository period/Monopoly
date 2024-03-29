const express = require("express");
const app = express();
const http = require("http").Server(app);
const fs = require("fs");
const io = require("socket.io")(http);

var games = {};

app.get("/", function (req, res) {
    res.header("Content-Type", "text/html");
    res.send(fs.readFileSync("index.html"));
})
app.get("/board", function (req, res) {
    res.header("Content-Type", "text/html");
    res.send(fs.readFileSync("board.html"));
})
app.use(express.static("public"));

app.get("/create-game", function (req, res) {
    var gameId = Math.random().toString(36).substring(8); // game ids are random 4char strings
    games[gameId] = JSON.parse(fs.readFileSync("base-game.json"));
    res.header("Content-Type", "application/json");
    res.send(JSON.stringify({ game: gameId }));

})
app.get("/games", function(req, res) {
    res.header("Content-Type", "application/json");
    res.send(JSON.stringify(Object.keys(games)))
})
app.get("/game/:game", function(req, res) {
    res.header("Content-Type", "application/json");
    if(games[req.params.game] == null) return res.send(JSON.stringify({message: "Game not found"}));
    var tmpGame = Object.assign({}, games[req.params.game]);
    var tmpPlayers = [];
    for(var i = 0; i < tmpGame.players.length; i++) {
        tmpPlayers.push({piece: tmpGame.players[i].piece, balance: tmpGame.players[i].balance, position: tmpGame.players[i].position});
    }
    tmpGame.players = tmpPlayers;
    res.send(JSON.stringify(tmpGame));
})

function sendGameUpdate(gameId) {
    var tmpGame = Object.assign({}, games[gameId]);
    var tmpPlayers = [];
    for(var i = 0; i < tmpGame.players.length; i++) {
        tmpPlayers.push({piece: tmpGame.players[i].piece, balance: tmpGame.players[i].balance, position: tmpGame.players[i].position});
    }
    tmpGame.players = tmpPlayers;
    io.to(gameId).emit("game-update", tmpGame);
}

io.on("connection", function (socket) {
    socket.on("join-room", function (data) {
        data = data.toString();
        if (games[data] == null) return socket.emit("eval", "window.location.href = \"./\"");
        if(io.sockets.adapter.rooms[data] != null && io.sockets.adapter.rooms[data].length >= 6) {
            socket.emit("swal", { type: "error", title: "Game is full", message: "This room is currently full."});
            setTimeout(function() {
                socket.emit("eval", "window.location.href = \"./\"");
            }, 10000)
            return;
        }
        if(socket.gid != null) {
            socket.emit("swal", { type: "error", title: "Can't join game", message: "It would appear you are already in an active game."});
            setTimeout(function() {
                socket.emit("eval", "window.location.href = \"./\"");
            }, 10000)
            return;
        }
        socket.gid = data;
        socket.join(data);
        socket.emit("message", { type: "success", message: "Successfully joined game (" + io.sockets.adapter.rooms[data].length + " in room)" });
        sendGameUpdate(data);
        if (games[data].state == "Lobby" && io.sockets.adapter.rooms[data].length == 2) {
            var countdown = 30;
            games[data].state = "Starting";
            var countdownTimer = setInterval(() => {
                io.to(data).emit("countdown", countdown);
                countdown--;
                if (countdown == -1) {
                    clearInterval(countdownTimer);
                    if (io.sockets.adapter.rooms[data].length < 1) {
                        io.to(data).emit("message", { type: "warning", message: "Not enough players... (" + io.sockets.adapter.rooms[data].length + " in room)" });
                        countdown = 30;
                        games[data].state = "Lobby";
                    }
                    else {
                        io.to(data).emit("message", { type: "success", message: "Game has started! (" + io.sockets.adapter.rooms[data].length + " in room)" });
                        games[data].state = "Ingame";
                        for (var sock of getSocketsInGame(data)) {
                            var selectedPiece = games[data]["available-positions"].pop();
                            sock.emit("piece-selected", selectedPiece);
                            io.to(data).emit("move-update", { player: selectedPiece, position: 0 });
                            sock.piece = selectedPiece;
                            sock.balance = 1500;
                            sock.position = 0;
                            games[data].players.push(sock);
                        }
                        nextRound(data);
                    }
                }
            }, 1000);
        }
        if (games[data].state == "Ingame") {
            //socket.emit("piece-selected", socket.piece);
        }
    })

    socket.on("disconnect", function() {
        if(socket.gid != null && socket.piece != null) updateBalance(socket.gid, socket, -99999);
    })

    socket.on("force-nextround", function () {
        games[socket.gid].nextRoundCountdown = 0;
    });
    socket.on("purchase-property", function (data) {
        if (games[socket.gid].state != "Ingame") return socket.emit("swal", { title: "Not ingame", message: "The game you're in isn't ingame", type: "error" });
        if (socket.position != data.position) return socket.emit("swal", { title: "Incorrect position", message: "You have to be at this property to purchase it", type: "error" })
        if (games[socket.gid].properties[data.position].owner != null) return socket.emit("swal", { title: "Already owned", message: "This property has already been purchased", type: "error" })
        if (games[socket.gid].properties[data.position].price > socket.balance) return socket.emit("swal", { title: "Not enough", message: "You don't have enough balance to do this.", type: "error" });
        updateBalance(socket.gid, socket, 0 - games[socket.gid].properties[data.position].price);
        games[socket.gid].properties[data.position].owner = socket.piece;
        socket.emit("swal", { title: "Purchased!", message: "You now own " + games[socket.gid].properties[data.position].name + "!", type: "success" });
        io.to(socket.gid).emit("message", { type: "info", message: "<strong>" + socket.piece + "</strong> has purchased <strong>" + games[socket.gid].properties[data.position].name + "</strong>!" });
        sendGameUpdate(socket.gid);
    })
    socket.on("mortgage-property", function (data) {
        if (games[socket.gid].state != "Ingame") return socket.emit("swal", { title: "Not ingame", message: "The game you're in isn't ingame", type: "error" });
        if (games[socket.gid].properties[data.position].owner == null) return socket.emit("swal", { title: "Not owned", message: "This property is not owned by anybody", type: "error" })
        if (games[socket.gid].properties[data.position].owner != socket.piece) return socket.emit("swal", { title: "Not owned", message: "You don't own this property", type: "error" })
        if (games[socket.gid].properties[data.position].hasOwnProperty("addons") && games[socket.gid].properties[data.position].addons.length > 0) return socket.emit("swal", { title: "Existing House/Hotel", message: "There's a house or hotel on this property. Sell those first!", type: "error" })
        games[socket.gid].properties[data.position].owner = null;
        updateBalance(socket.gid, socket, (games[socket.gid].properties[data.position].price / 2));
        socket.emit("swal", { title: "Mortgaged!", message: "You now no longer own " + games[socket.gid].properties[data.position].name + "!", type: "success" });
        io.to(socket.gid).emit("message", { type: "info", message: "<strong>" + socket.piece + "</strong> has mortgaged <strong>" + games[socket.gid].properties[data.position].name + "</strong>!" });
        sendGameUpdate(socket.gid);
    })
    socket.on("purchase-addon-house", function (data) {
        if (games[socket.gid].state != "Ingame") return socket.emit("swal", { title: "Not ingame", message: "The game you're in isn't ingame", type: "error" });
        if (games[socket.gid].properties[data.position].owner == null) return socket.emit("swal", { title: "Not owned", message: "This property is not owned by anybody", type: "error" })
        if (games[socket.gid].properties[data.position].owner != socket.piece) return socket.emit("swal", { title: "Not owned", message: "You don't own this property", type: "error" })
        if (games[socket.gid].properties[data.position].hasOwnProperty("addons") == false) return socket.emit("swal", { title: "Not available", message: "Houses/hotels cannot be purchased on this type of property", type: "error" })

        var housesSameColourOwnedBySameOwner = 0;
        for (var i = 0; i < games[socket.gid].properties.length; i++) {
            if (games[socket.gid].properties[i].type == "house" && games[socket.gid].properties[i].colour == games[socket.gid].properties[data.position].colour && games[socket.gid].properties[i].owner != null && games[socket.gid].properties[i].owner == games[socket.gid].properties[data.position].owner) housesSameColourOwnedBySameOwner++;
        }
        var propertiesInGroup = 3;
        if (games[socket.gid].properties[data.position].colour == "brown" || games[socket.gid].properties[data.position].colour == "blue") propertiesInGroup = 2;

        if (housesSameColourOwnedBySameOwner != propertiesInGroup) return socket.emit("swal", { title: "Not available", message: "You must own the full set before you can add addons.", type: "error" })

        var hasHotel = false;
        var numberOfHouses = 0;
        for (var i = 0; i < games[socket.gid].properties[data.position].addons.length; i++) {
            if (games[socket.gid].properties[data.position].addons[i] == "house") numberOfHouses++;
            else hasHotel = true;
        }
        if (hasHotel) return socket.emit("swal", { title: "Not available", message: "You have a hotel!", type: "error" })
        if (numberOfHouses >= 4) return socket.emit("swal", { title: "Not available", message: "Maximum houses reached. Consider buying a hotel!", type: "error" });

        if (games[socket.gid].properties[data.position].pricing.house > socket.balance) return socket.emit("swal", { title: "Insufficient balance", message: "You don't have enough money to purchase this.", type: "error" })
        games[socket.gid].properties[data.position].addons.push("house");
        updateBalance(socket.gid, socket, (0 - games[socket.gid].properties[data.position].pricing.house));
        socket.emit("swal", { title: "Purchase Successful", message: "You have purchased a house on " + games[socket.gid].properties[data.position].name + "!", type: "success" });
        io.to(socket.gid).emit("message", { type: "info", message: "<strong>" + socket.piece + "</strong> has added a house to <strong>" + games[socket.gid].properties[data.position].name + "</strong>!" });
        sendGameUpdate(socket.gid);
    });
    socket.on("purchase-addon-hotel", function (data) {
        if (games[socket.gid].state != "Ingame") return socket.emit("swal", { title: "Not ingame", message: "The game you're in isn't ingame", type: "error" });
        if (games[socket.gid].properties[data.position].owner == null) return socket.emit("swal", { title: "Not owned", message: "This property is not owned by anybody", type: "error" })
        if (games[socket.gid].properties[data.position].owner != socket.piece) return socket.emit("swal", { title: "Not owned", message: "You don't own this property", type: "error" })
        if (games[socket.gid].properties[data.position].hasOwnProperty("addons") == false) return socket.emit("swal", { title: "Not available", message: "Houses/hotels cannot be purchased on this type of property", type: "error" })
        var hasHotel = false;
        var numberOfHouses = 0;
        for (var i = 0; i < games[socket.gid].properties[data.position].addons.length; i++) {
            if (games[socket.gid].properties[data.position].addons[i] == "house") numberOfHouses++;
            else hasHotel = true;
        }
        if (hasHotel) return socket.emit("swal", { title: "Not available", message: "You already have a hotel!", type: "error" })
        if (numberOfHouses < 4) return socket.emit("swal", { title: "Not available", message: "Maximum houses reached. Consider buying a hotel!", type: "error" });

        if (games[socket.gid].properties[data.position].pricing.hotel > socket.balance) return socket.emit("swal", { title: "Insufficient balance", message: "You don't have enough money to purchase this.", type: "error" })
        games[socket.gid].properties[data.position].addons = ["hotel"]
        updateBalance(socket.gid, socket, (0 - games[socket.gid].properties[data.position].pricing.hotel));
        socket.emit("swal", { title: "Purchase Successful", message: "You have purchased a hotel on " + games[socket.gid].properties[data.position].name + "!", type: "success" });
        io.to(socket.gid).emit("message", { type: "info", message: "<strong>" + socket.piece + "</strong> has added a hotel to <strong>" + games[socket.gid].properties[data.position].name + "</strong>!" });
        sendGameUpdate(socket.gid);
    });
    socket.on("sell-addon-hotel", function (data) {
        if (games[socket.gid].state != "Ingame") return socket.emit("swal", { title: "Not ingame", message: "The game you're in isn't ingame", type: "error" });
        if (games[socket.gid].properties[data.position].owner == null) return socket.emit("swal", { title: "Not owned", message: "This property is not owned by anybody", type: "error" })
        if (games[socket.gid].properties[data.position].owner != socket.piece) return socket.emit("swal", { title: "Not owned", message: "You don't own this property", type: "error" })
        if (games[socket.gid].properties[data.position].hasOwnProperty("addons") == false) return socket.emit("swal", { title: "Not available", message: "Houses/hotels cannot be purchased on this type of property", type: "error" })
        var hasHotel = false;
        var numberOfHouses = 0;
        for (var i = 0; i < games[socket.gid].properties[data.position].addons.length; i++) {
            if (games[socket.gid].properties[data.position].addons[i] == "house") numberOfHouses++;
            else hasHotel = true;
        }
        if (hasHotel == false) return socket.emit("swal", { title: "Not available", message: "This property does not have a hotel", type: "error" })

        games[socket.gid].properties[data.position].addons = ["house", "house", "house", "house"];
        updateBalance(socket.gid, socket, (games[socket.gid].properties[data.position].pricing.hotel));
        socket.emit("swal", { title: "Sale Successful", message: "You have sold the hotel on " + games[socket.gid].properties[data.position].name + "!", type: "success" });
        io.to(socket.gid).emit("message", { type: "info", message: "<strong>" + socket.piece + "</strong> has sold the hotel on <strong>" + games[socket.gid].properties[data.position].name + "</strong>!" });
        sendGameUpdate(socket.gid);
    });
    socket.on("sell-addon-house", function (data) {
        if (games[socket.gid].state != "Ingame") return socket.emit("swal", { title: "Not ingame", message: "The game you're in isn't ingame", type: "error" });
        if (games[socket.gid].properties[data.position].owner == null) return socket.emit("swal", { title: "Not owned", message: "This property is not owned by anybody", type: "error" })
        if (games[socket.gid].properties[data.position].owner != socket.piece) return socket.emit("swal", { title: "Not owned", message: "You don't own this property", type: "error" })
        if (games[socket.gid].properties[data.position].hasOwnProperty("addons") == false) return socket.emit("swal", { title: "Not available", message: "Houses/hotels cannot be purchased on this type of property", type: "error" })
        var hasHotel = false;
        var numberOfHouses = 0;
        for (var i = 0; i < games[socket.gid].properties[data.position].addons.length; i++) {
            if (games[socket.gid].properties[data.position].addons[i] == "house") numberOfHouses++;
            else hasHotel = true;
        }
        if (hasHotel == true) return socket.emit("swal", { title: "Not available", message: "This property has a hotel. Sell that first.", type: "error" })

        if (numberOfHouses < 1) return socket.emit("swal", { title: "Not available", message: "This property does not have any houses", type: "error" })

        numberOfHouses--;
        games[socket.gid].properties[data.position].addons = [];

        for (var i = 0; i < numberOfHouses; i++) games[socket.gid].properties[data.position].addons.push("house");

        updateBalance(socket.gid, socket, (games[socket.gid].properties[data.position].pricing.house));
        socket.emit("swal", { title: "Sale Successful", message: "You have sold a house on " + games[socket.gid].properties[data.position].name + "!", type: "success" });
        io.to(socket.gid).emit("message", { type: "info", message: "<strong>" + socket.piece + "</strong> has sold a house on <strong>" + games[socket.gid].properties[data.position].name + "</strong>!" });
        sendGameUpdate(socket.gid);
    });
});

http.listen(4921, function () {
    console.log("WSS server started on 4921");
});

function getSocketsInGame(gameId) {
    var sockets = [];
    for (var clientId in io.sockets.clients().sockets) {
        if (io.of("/").connected[clientId].gid == gameId) sockets.push(io.of("/").connected[clientId]);
    }
    return sockets;
}

function rollDice(gameId, callback) {
    var counter = 10;
    io.to(gameId).emit("dice-start");
    var diceRoller = setInterval(() => {
        var diceA = Math.floor(Math.random() * 6) + 1;
        var diceB = Math.floor(Math.random() * 6) + 1;
        io.to(gameId).emit("dice", { a: diceA, b: diceB });
        counter--;
        if (counter == 0) {
            io.to(gameId).emit("dice-stop");
            clearInterval(diceRoller);
            setTimeout(function () {
                callback(diceA, diceB, (diceA + diceB));
            }, 1500); // there's a delay on the client end to allow user to see the result. we'll delay the callback the same amount to stop the game progressing
        }
    }, 100);
}
function updateFreeParking(gameId, amount) {
    games[gameId]["free-parking"] += amount;
    io.to(gameId).emit("free-parking", games[gameId]["free-parking"]);
    io.to(gameId).emit("message", { type: "info", message: "Free Parking updated! There's now M" + games[gameId]["free-parking"] + " up for grabs." });
}
function updateBalance(gameId, player, amount) {
    if(games[gameId] == null) return;
    player.balance += amount;
    io.to(gameId).emit("balance-update", { player: player.piece, balance: player.balance });
    sendGameUpdate(gameId);
    if(player.balance < 0) {
        io.to(gameId).emit("message", {type: "danger", message: "<strong>" + player.piece + "</strong> has gone bankrupt. They are now out of the game. All properties owned by them are now un-owned."});
        for(var i = 0; i < games[gameId].properties.length; i++) {
            if(games[gameId].properties[i].owner != null && games[gameId].properties[i].owner == player.piece) {
                games[gameId].properties[i].owner = null;
                if(games[gameId].properties[i].hasOwnProperty("addons")) games[gameId].properties[i].addons = [];
            }
        }
        for(var i = 0; i < games[gameId].players.length; i++) {
            if(games[gameId].players[i].piece == player.piece) games[gameId].players.splice(i, 1);
        }
        player.balance = 0;
        player.piece = null;
        player.position = 0;
        player.gid = null;
        sendGameUpdate(gameId);
    }
    
}
function moveToPosition(gameId, player, amount, callback) {
    var toGo = amount;
    var mover = setInterval(() => {
        toGo--;
        player.position++;
        if (player.position >= 40) {
            player.position = 0;
            // Passed go, issue 200
            updateBalance(gameId, player, 200);
        }
        io.to(gameId).emit("move-update", { player: player.piece, position: player.position });
        if (toGo == 0) {
            clearInterval(mover);
            if(games[gameId].properties[player.position].type == "go") {
                updateBalance(gameId, player, 200);
                io.to(gameId).emit("message", { type: "warning", message: "<strong>" + player.piece + "</strong> landed on go and received an additional M200." });
            }
            if (games[gameId].properties[player.position].type == "go-to-jail") {
                player.position = 10; // landed on go to jail; send to jail
                io.to(gameId).emit("move-update", { player: player.piece, position: player.position });
                io.to(gameId).emit("message", { type: "warning", message: "<strong>" + player.piece + "</strong> was sent to jail and paid M50 for release." });
                updateBalance(gameId, player, -50);
                updateFreeParking(gameId, 50);
            }
            else if (games[gameId].properties[player.position].type == "chance" || games[gameId].properties[player.position].type == "community-chest") {
                var selectedCard = games[gameId].cards[games[gameId].properties[player.position].type][Math.floor(Math.random()*games[gameId].cards[games[gameId].properties[player.position].type].length)];
                io.to(gameId).emit("select-card", {type: games[gameId].properties[player.position].type, text: selectedCard.text})
                if(selectedCard.type == "RECEIVE_MONEY") {
                    updateBalance(gameId, player, selectedCard.amount);
                }
                else if(selectedCard.type == "GO_TO_JAIL") {
                    player.position = 10;
                    io.to(gameId).emit("move-update", { player: player.piece, position: player.position });
                    io.to(gameId).emit("message", { type: "warning", message: "<strong>" + player.piece + "</strong> was sent to jail and paid M50 for release." });
                    updateBalance(gameId, player, -50);
                    updateFreeParking(gameId, 50);
                }
                else if(selectedCard.type == "MOVE_X_SPACES") {
                    player.position -= 3;
                    io.to(gameId).emit("move-update", { player: player.piece, position: player.position });
                }
                else if(selectedCard.type == "MOVE_TO_POSITION") {
                    player.position = selectedCard.position;
                    io.to(gameId).emit("move-update", { player: player.piece, position: player.position });
                }
                else if(selectedCard.type == "MOVE_TO_NEAREST_STATION") {
                    var found = false;
                    while(found == false) {
                        player.position++;
                        if(games[gameId].properties[player.position].type == "station") found = true;
                        if(player.position >= 40) {
                            player.position = 0;
                            // Passed go, issue 200
                            updateBalance(gameId, player, 200);
                        }
                        io.to(gameId).emit("move-update", { player: player.piece, position: player.position });
                    }
                }
                else if(selectedCard.type == "ALL_PLAYERS_PAY_PLAYER") {
                    var socks = getSocketsInGame(gameId);
                    var sum = 0;
                    for (var i = 0; i < socks.length; i++) {
                        if (socks[i].piece != player.piece) {
                            updateBalance(gameId, socks[i], 0-selectedCard.amount);
                            sum++;
                        }
                    }
                    updateBalance(gameId, player, sum);
                }
                else if(selectedCard.type == "PAY_TAX") {
                    updateBalance(gameId, player, 0-selectedCard.tax);
                    updateFreeParking(gameId, selectedCard.tax);
                }
                else if(selectedCard.type == "REPAIRS") {
                    var repairsTotal = 0;
                    for(var i = 0; i < games[gameId].properties.length; i++) {
                        if(games[gameId].properties[i].owner != null && games[gameId].properties[i].addons != null && games[gameId].properties[i].owner == player.piece) {
                            for(var u = 0; u < games[gameId].properties[i].addons.length; u++) {
                                if(games[gameId].properties[i].addons[u] == "hotel") repairsTotal += selectedCard.hotel;
                                if(games[gameId].properties[i].addons[u] == "house") repairsTotal += selectedCard.house;
                            }
                        }
                    }
                    updateBalance(gameId, player, 0-repairsTotal);
                    updateFreeParking(gameId, repairsTotal);
                }
            }


            if (games[gameId].properties[player.position].type == "free-parking") {
                io.to(gameId).emit("message", { type: "success", message: "<strong>" + player.piece + "</strong> landed on free parking and collected M" + games[gameId]["free-parking"] + "." });
                updateBalance(gameId, player, games[gameId]["free-parking"]);
                updateFreeParking(gameId, 0 - games[gameId]["free-parking"]);
            }
            else if (games[gameId].properties[player.position].type == "tax") {
                io.to(gameId).emit("message", { type: "warning", message: "<strong>" + player.piece + "</strong> was ordered to pay <strong>" + games[gameId].properties[player.position].tax + "</strong> in tax." });
                updateBalance(gameId, player, 0-games[gameId].properties[player.position].tax);
                updateFreeParking(gameId, games[gameId].properties[player.position].tax);
            }
            else if (games[gameId].properties[player.position].type == "house" || games[gameId].properties[player.position].type == "utility" || games[gameId].properties[player.position].type == "station") {
                if (games[gameId].properties[player.position].owner != null && games[gameId].properties[player.position].owner != player.piece) {
                    var rentPayable = 0;
                    if (games[gameId].properties[player.position].type == "station") {
                        var stationsOwnedBySameOwner = 0;
                        for (var i = 0; i < games[gameId].properties.length; i++) {
                            if (games[gameId].properties[i].type == "station" && games[gameId].properties[i].owner != null && games[gameId].properties[i].owner == games[gameId].properties[player.position].owner) stationsOwnedBySameOwner++;
                        }
                        rentPayable = games[gameId]["station-rents"][stationsOwnedBySameOwner - 1];
                    }
                    else if (games[gameId].properties[player.position].type == "utility") {
                        var utilitiesOwnedBySameOwner = 0;
                        for (var i = 0; i < games[gameId].properties.length; i++) {
                            if (games[gameId].properties[i].type == "utility" && games[gameId].properties[i].owner != null && games[gameId].properties[i].owner == games[gameId].properties[player.position].owner) utilitiesOwnedBySameOwner++;
                        }
                        if (utilitiesOwnedBySameOwner == 2) rentPayable = amount * 10;
                        else rentPayable = amount * 4;
                    }
                    else if (games[gameId].properties[player.position].type == "house") {
                        var housesSameColourOwnedBySameOwner = 0;
                        for (var i = 0; i < games[gameId].properties.length; i++) {
                            if (games[gameId].properties[i].type == "house" && games[gameId].properties[i].colour == games[gameId].properties[player.position].colour && games[gameId].properties[i].owner != null && games[gameId].properties[i].owner == games[gameId].properties[player.position].owner) housesSameColourOwnedBySameOwner++;
                        }
                        var propertiesInGroup = 3;
                        if (games[gameId].properties[player.position].colour == "brown" || games[gameId].properties[player.position].colour == "blue") propertiesInGroup = 2;

                        rentPayable = games[gameId].properties[player.position].rent[0]; // get base rent no houses
                        if (propertiesInGroup == housesSameColourOwnedBySameOwner) rentPayable = rentPayable * 2; // double rent due to having no houses but full set

                        // it gets a bit more complicated calculating rent for houses/hotel...
                        var houses = 0;
                        var hasHotel = false;
                        for (var i = 0; i < games[gameId].properties[player.position].addons.length; i++) {
                            if (games[gameId].properties[player.position].addons[i] == "house") houses++;
                            else hasHotel = true;
                        }
                        if (hasHotel == true) rentPayable = games[gameId].properties[player.position].rent[5];
                        if (houses > 0) rentPayable = games[gameId].properties[player.position].rent[houses];
                    }
                    io.to(gameId).emit("message", { type: "warning", message: "<strong>" + player.piece + "</strong> paid <strong>M" + rentPayable + "</strong> in rent to <strong>" + games[gameId].properties[player.position].owner + "</strong>." });
                    updateBalance(gameId, player, 0 - rentPayable);
                    var socks = getSocketsInGame(gameId);
                    for (var i = 0; i < socks.length; i++) {
                        if (socks[i].piece == games[gameId].properties[player.position].owner) updateBalance(gameId, socks[i], rentPayable);
                    }
                }
            }
            callback();
        }
    }, 250);
}

function nextRound(gameId) {
    if (games[gameId] == null) return;
    if (games[gameId].players.length <= 1) return gameOver(gameId); // no players OR just one player remaining
    sendGameUpdate(gameId);
    // First step is to find the next player!
    var currentPlayer = null;
    for (var i = 0; i < games[gameId].players.length; i++) {
        if(games[gameId].players[i].gid == null || games[gameId].players[i].hasOwnProperty("gid") == false) continue; // skip over bankrupt people
        if (games[gameId]["has-played-round"].includes(games[gameId].players[i].piece) == false) {
            currentPlayer = games[gameId].players[i];
            games[gameId]["has-played-round"].push(games[gameId].players[i].piece);
            break;
        }
    }
    if (currentPlayer == null) { // No player found - maybe we filled the array. Clear it, retry.
        games[gameId]["has-played-round"] = [];
        return nextRound(gameId);
    }
    games[gameId].currentPiece = currentPlayer.piece;
    io.to(gameId).emit("message", { type: "info", message: "It's now " + currentPlayer.piece + "'s turn!" });
    io.to(gameId).emit("new-round", currentPlayer.piece);

    rollDice(gameId, function (diceA, diceB, sum) {
        io.to(gameId).emit("message", { type: "info", message: currentPlayer.piece + " rolled <strong>" + sum + "</strong>." });
        moveToPosition(gameId, currentPlayer, sum, function () {
            sendGameUpdate(gameId);
            games[gameId].nextRoundCountdown = 20;
            var nextRoundInterval = setInterval(function () {
                io.to(gameId).emit("round-countdown", games[gameId].nextRoundCountdown);
                if (games[gameId].nextRoundCountdown < 1) {
                    nextRound(gameId);
                    clearInterval(nextRoundInterval);
                }
                games[gameId].nextRoundCountdown--;
            }, 1000);
        })
    })
}
function gameOver(gameId) {
    io.to(gameId).emit("swal", { type: "success", title: "Game Over", message: "There are no players left to compete!"});
    setTimeout(function () {
        io.to(gameId).emit("eval", "window.location.href = \"./\"");
        games[gameId] = null;
    }, 15000);
}
process.on("uncaughtException", function(ex) {
    console.log("Caught " + ex);
});