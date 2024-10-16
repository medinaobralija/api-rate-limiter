import express from 'express';
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const client = createClient({ url: 'redis://localhost:6379' });

async function connectRedis() {
	try {
		await client.connect();
		console.log('Connected to Redis...');
	} catch (err) {
		console.error('Redis connection error:', err);
	}
}

await connectRedis();

client.on('error', (err) => {
	console.error('Redis Client Error', err);
});

client.on('ready', () => {
	console.log('Redis client connected and ready!');
});

client.on('end', () => {
	console.log('Redis client disconnected');
});

const getAsync = client.get.bind(client);
const setExAsync = client.setEx.bind(client);

// Middleware for rate limiting
const rateLimiter = async (req, res, next) => {
	try {
		if (!client.isOpen) {
			console.error('Redis client is not connected');
			return res.status(500).json({ message: 'Redis connection error' });
		}

		const userIP = req.ip;
		const timeWindow = process.env.TIME_WINDOW || 60;
		const maxRequests = process.env.MAX_REQUESTS || 5;

		const currentRequestCount = await getAsync(userIP);
		const requestCount = currentRequestCount
			? parseInt(currentRequestCount)
			: 0;

		if (requestCount >= maxRequests) {
			console.log(`Rate limit exceeded for IP: ${userIP}`);
			return res.status(429).json({
				message: 'Too many requests. Please try again later.',
			});
		} else {
			await setExAsync(userIP, timeWindow, (requestCount + 1).toString());
			next();
		}
	} catch (error) {
		console.error('Error in rateLimiter:', error);
		res.status(500).json({ message: 'Internal server error' });
	}
};

// Route
app.get('/', rateLimiter, (req, res) => {
	res.send('Welcome, your request is within limit!');
});

// Listen for requests
app.listen(port, () => {
	console.log(`Server running on http://localhost:${port}`);
});
