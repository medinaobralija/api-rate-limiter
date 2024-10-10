const express = require('express');
const app = express();
const port = 3000;
const redis = require('redis');
const client = redis.createClient();

client.connect().then(() => {
	console.log('Connected to Redis...');
});

const rateLimiter = async (req, res, next) => {
	const userIP = req.ip;
	const timeWindow = 60; // 1 minute
	const maxRequests = 5;

	try {
		const record = await client.get(userIP);
		const currentRequestCount = record ? parseInt(record) : 0;

		if (currentRequestCount >= maxRequests) {
			res.status(429).send('Too many requests. Please try again later.');
		} else {
			await client.setEx(
				userIP,
				timeWindow.toString(),
				(currentRequestCount + 1).toString()
			);
			next();
		}
	} catch (err) {
		console.error('Error in rateLimiter:', err);
		res.status(500).send('Internal Server Error');
	}
};

app.get('/', rateLimiter, (req, res) => {
	res.send('Welcome, your request is within limit!');
});

app.listen(port, () => {
	console.log(`Server running on http://localhost:${port}`);
});
