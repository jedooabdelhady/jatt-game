<a name="readme-top"></a>

<div align="center">
  <h1>🎲 جاطت (Jatt)</h1>
  <p>
    <b>A Hilarious Multiplayer Bluffing & Trivia Game</b>
    <br />
    <i>Deceive your friends, find the truth, and top the leaderboard!</i>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socket.io&logoColor=white" alt="Socket.io" />
    <img src="https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
    <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5" />
    <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" alt="CSS3" />
  </p>

  <p>
    <a href="#about-the-project">About</a> •
    <a href="#features">Features</a> •
    <a href="#how-to-play">How To Play</a> •
    <a href="#getting-started">Getting Started</a> •
    <a href="#roadmap">Roadmap</a>
  </p>
</div>

<br />

## 📖 About The Project

**Jatt (جاطت)** is a web-based, real-time multiplayer game designed for friends and communities. The core concept is simple: **Bluffing**.

Players are presented with a question (Trivia, General Knowledge, etc.).
1.  Everyone writes a **fake answer** (a lie) that looks real.
2.  The system mixes these lies with the **real answer (Truth)**.
3.  Players vote on what they think the truth is.
4.  Points are awarded for finding the truth and for tricking others into voting for your lie.

The interface is built with a modern **Glassmorphism** design, fully responsive for mobile devices, and supports right-to-left (RTL) Arabic text natively.

---

## ✨ Features

### 🎮 Gameplay
* **Real-Time Multiplayer:** Powered by `Socket.io` for instant interaction.
* **Game Loop:** Question Phase -> Answering Phase -> Voting Phase -> Results.
* **Smart Timer:** Server-side timer that automatically moves the game forward if players are idle.
* **Scoring System:** * +2 Points for finding the Truth.
    * +1 Point for every player you deceive.

### 🏠 Room System
* **Private Rooms:** Create a room, get a 4-digit code, and invite friends.
* **Public Rooms:** List of open rooms for anyone to join.
* **Permanent Rooms:** 24/7 dedicated rooms (Football, Variety, etc.) that reset automatically.
* **Host Controls:** The room creator can set the number of rounds, timer duration, and topics.

### 🎨 Customization & Social
* **Avatar Creator:** Built-in SVG generator allowing players to customize color, face, and hats.
* **Social Profile:** Link Instagram/Snapchat accounts so players can follow each other.
* **Draggable Chat:** A floating chat window with avatars to talk while playing without blocking the game view.
* **Reconnection System:** If you refresh or lose internet, the game puts you back exactly where you were.

---

## 🕹️ How To Play

1.  **Create Profile:** Choose your name and customize your avatar.
2.  **Join/Create:** Enter a code to join friends or create a new room.
3.  **The Game:**
    * **Topic:** The host (or server) picks a topic.
    * **Lie:** A question appears. Write a convincing lie!
    * **Vote:** Try to spot the real answer among your friends' lies.
    * **Win:** Collect points to top the leaderboard.

---

## ⚡ Getting Started

To run this project locally on your machine, follow these steps.

### Prerequisites

* **Node.js** (v14 or higher) installed.
* **npm** (Node Package Manager).

### Installation

1.  **Clone the repo**
    ```sh
    git clone [https://github.com/your-username/jatt-game.git](https://github.com/your-username/jatt-game.git)
    cd jatt-game
    ```

2.  **Install dependencies**
    ```sh
    npm install
    ```

3.  **Setup Questions File**
    * Ensure you have a file named `questions.js` in the root directory containing your question database (exported as a module).

4.  **Run the server**
    ```sh
    node server.js
    ```

5.  **Play**
    * Open your browser and go to `http://localhost:3000`

---

## 📂 Project Structure