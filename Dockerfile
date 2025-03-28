FROM node:18

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3051

CMD ["npm", "run", "docker_scira_socket"]
