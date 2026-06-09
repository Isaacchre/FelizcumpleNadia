const canvas = document.querySelector("canvas");
const secondsCount = document.querySelector(".seconds");
const level = document.querySelector(".grade");
const context = canvas.getContext("2d");
const pugDimensions = { width: 353 * 1.2, height: 325 * 1.2 };


const levels = {
  3: "beso!, ya nos casamos?",
  10: "No puedo imaginar un futuro sin ti. Eres mi hogar, mi amor y mi vida",
  20: "Si pudiera darte una cosa en la vida, te daría la capaz de verte a traves de mis ojos. Solo entonces comprenderías lo especial que eres para mí y tendrias miopia",
  30: "Mi lugar favorito es justo a tu lado, pero dentro tuyo es el segundo",
  40: "Te amo mucho mucho",
  50: "sin mi la Princesa se secaria",
  60: "¿Vamos a comer hamburguesas juntos 🍔🍟?",
  70: "1...",
  82: "1,2... ",
  84: "1,2,3...",
  87: "1,2,3... Ñam",
  88: "1,2,3... ",
  89: "1,2,3... Ñam",
  92: "Ñam",
  100: "ya no hay mas mensajes bb",
  110: "enserio solo hay esos jiji",
  120: "Mentira Ñammmmmmmm",
  121: "❤️ ",
  122: " Ñammmmmmmm",
  123: "❤️ ",
  124: " Ñammmmmmmm <3",
  125: "❤️ ",
  126: " Ñammmmmmmm",
  127: "❤️ ",
  128: " Ñammmmmmmm <3",
  129: "❤️ ",
  130: " Ñammmmmmmm",
  131: "❤️ ",
  132: " Te amo Ñammmmmmmm <3",
  140: "Bye Bye"
};
const startTime = Date.now();


const currentLevel = levels; 

function checkLevelActions() {    
    if (currentLevel === 10) {
        window.location.reload();
    } 
}

checkLevelActions();


canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
context.translate(window.innerWidth / 2, window.innerHeight / 2);

const image = new Image();
image.src = "./assets/2.png"; 
const loopingPugs = 30; // 125 pugs required to cover a full 4K television screen. Tested via Firefox DevTools
const offsetDistance = 120;
let currentOffset = 0;
const movementRange = 200
const mouseOffset = {
  x: 0,
  y: 0
}
const movementOffset = {
  x: 0,
  y: 0
}

image.onload = () => {
  startLooping();
};

window.onresize = () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  context.setTransform(1, 0, 0, 1, 0, 0); //Reset the canvas context
  context.translate(window.innerWidth / 2, window.innerHeight / 2);
};

window.addEventListener('mousemove', onMouseMove)

function draw(offset, loopCount) {

  let currentPercentage = (loopingPugs - loopCount) / loopingPugs
  context.drawImage(
    image,
    -pugDimensions.width / 2 - offset/2 + (movementOffset.x * currentPercentage),
    -pugDimensions.height / 2 - offset/2 + (movementOffset.y * currentPercentage),
    pugDimensions.width + offset,
    pugDimensions.height + offset
  );
}

function onMouseMove(e) {
  mouseOffset.x = (e.clientX - window.innerWidth / 2) / window.innerWidth / 2 * movementRange
  mouseOffset.y = (e.clientY - window.innerHeight / 2) / window.innerHeight / 2 * movementRange
}

function lerp(start, end, amount) {
  return start*(1-amount)+end*amount
}

function loopDraw() {

  movementOffset.x = lerp(movementOffset.x, mouseOffset.x, 0.05)
  movementOffset.y = lerp(movementOffset.y, mouseOffset.y, 0.05)

  for (let i = loopingPugs; i >= 1; i--) {
    draw(i * offsetDistance + currentOffset, i);
  }

  draw(offsetDistance, 1);

  currentOffset++;
  if (currentOffset >= offsetDistance) {
    currentOffset = 0;
  }

  const newTime = Math.floor((Date.now() - startTime) / 1000);

  secondsCount.innerText = newTime;

  if(levels[newTime]) {
    level.innerText = levels[newTime]
  }

  requestAnimationFrame(loopDraw);
}

function startLooping() {
  requestAnimationFrame(loopDraw);
}
;