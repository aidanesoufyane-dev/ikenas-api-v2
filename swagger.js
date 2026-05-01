const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "My API",
      version: "1.0.0",
      description: "API documentation for my Express app",
    },
    servers: [
    {
      url: "https://api.intranet.ikenas.com",
      description: "Production server",
    },
    {
      url: "https://api-demo.intranet.ikenas.com",
      description: "Demo server",
    },
    ],
  },
  apis: ["./routes/*.js"], // where your route files are
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
